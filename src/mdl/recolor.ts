/**
 * The recoloring engine.
 *
 * A preset is a color ramp running from shadow to highlight. Each pixel keeps
 * its original brightness and receives the ramp color that matches it, so the
 * model's own baked shading decides where every color lands.
 *
 * There are two ways to apply that, and which one runs depends on what is
 * being asked for:
 *
 *   palette  One ramp for the whole knife. Only the 768-byte palette is
 *            rewritten; pixel indices are untouched. Exact, and fast enough to
 *            run on every frame of a slider drag.
 *
 *   pixels   Different colours per part, or any pattern. A palette entry is
 *            shared across the whole texture, so as soon as colour depends on
 *            *where* a pixel is rather than only on how bright it was, the
 *            indices have to be rewritten too, and the result quantized back
 *            down to 256 colours.
 *
 * Both edit in place. The pixel array and the palette are the same size before
 * and after, so the file's length and every offset inside it are unchanged.
 */

import { PALETTE_BYTES, type MdlFile, type MdlTexture } from "./parse";
import { PALETTE_ENTRIES, paletteHistogram, paletteOffset, readPalette, readPixels } from "./texture";
import { patternById } from "./patterns";
import { quantize } from "./quantize";
import { REGION_NONE, type RegionMask } from "./regions";
import { applyTint, hexToHsv, ORIGINAL_FINISH, type Finish } from "./finish";

export type Rgb = [number, number, number];

export interface RampStop {
  /** Position along the ramp, 0 = deepest shadow, 1 = brightest highlight. */
  at: number;
  color: Rgb;
}

export interface Adjust {
  /** -1 darkens, 0 neutral, +1 brightens. */
  brightness: number;
  /** -1 flattens, 0 neutral, +1 deepens the shadow-to-highlight spread. */
  contrast: number;
}

export const NEUTRAL_ADJUST: Adjust = { brightness: 0, contrast: 0 };

/**
 * Pixels this dark are unused atlas padding rather than shaded surface. They
 * are held down so a ramp with a bright shadow stop cannot light up the empty
 * space around the UV islands.
 */
const DEAD_SPACE_CUTOFF = 0.04;

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Perceived brightness of a palette entry, matching how the ramp is indexed. */
function brightnessOf(palette: Uint8Array, entry: number): number {
  const o = entry * 3;
  return Math.max(palette[o], palette[o + 1], palette[o + 2]) / 255;
}

export interface BrightnessRange {
  low: number;
  high: number;
}

/**
 * The brightness band a texture actually occupies, weighted by how many pixels
 * use each palette entry.
 *
 * Knives in the library vary enormously here: some sit almost entirely in
 * near-black while others are bright throughout. Stretching each texture's own
 * band across the ramp is what makes a single preset read the same way on all
 * of them.
 */
export function measureBrightness(palette: Uint8Array, pixels: Uint8Array): BrightnessRange {
  const counts = paletteHistogram(pixels);
  const used: Array<{ value: number; weight: number }> = [];
  let total = 0;

  for (let entry = 0; entry < PALETTE_ENTRIES; entry += 1) {
    const weight = counts[entry];
    if (weight === 0) continue;
    const value = brightnessOf(palette, entry);
    if (value <= DEAD_SPACE_CUTOFF / 2) continue; // pure padding, not surface
    used.push({ value, weight });
    total += weight;
  }
  if (total === 0) return { low: 0, high: 1 };

  used.sort((a, b) => a.value - b.value);
  const percentile = (fraction: number): number => {
    let seen = 0;
    for (const sample of used) {
      seen += sample.weight;
      if (seen >= total * fraction) return sample.value;
    }
    return 1;
  };

  const low = percentile(0.02);
  const high = percentile(0.98);
  // A texture with almost no tonal range would otherwise divide by ~zero.
  return high - low < 0.05 ? { low, high: low + 0.05 } : { low, high };
}

function sampleRamp(stops: RampStop[], t: number): Rgb {
  if (stops.length === 0) return [0, 0, 0];
  if (t <= stops[0].at) return stops[0].color;

  const last = stops[stops.length - 1];
  if (t >= last.at) return last.color;

  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t < a.at || t > b.at) continue;
    const span = b.at - a.at;
    const f = span === 0 ? 0 : (t - a.at) / span;
    return [
      a.color[0] + (b.color[0] - a.color[0]) * f,
      a.color[1] + (b.color[1] - a.color[1]) * f,
      a.color[2] + (b.color[2] - a.color[2]) * f,
    ];
  }
  return last.color;
}

export interface RecoloredTexture {
  texture: MdlTexture;
  palette: Uint8Array;
  /** Rewritten indices, present only when the pixel path ran. */
  pixels?: Uint8Array;
}

/**
 * Produces the exportable file: a copy of the original bytes with the new
 * palettes, and where the pixel path ran, the new indices, written over the old
 * ones. Both are the same length as what they replace, so nothing else moves
 * and the result is as loadable as what went in.
 */
export function buildRecoloredFile(
  model: MdlFile,
  recolored: RecoloredTexture[],
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(model.buffer.slice(0));
  for (const { texture, palette, pixels } of recolored) {
    if (pixels) out.set(pixels, texture.index);
    out.set(palette, paletteOffset(texture));
  }
  return out;
}

/**
 * The brightness band of one region, measured over only its own texels so a
 * dark handle and a bright blade each use the full width of their ramp.
 */
function regionBand(
  palette: Uint8Array,
  pixels: Uint8Array,
  mask: RegionMask | null,
  regionId: number,
): BrightnessRange {
  if (!mask) return measureBrightness(palette, pixels);

  const counts = new Uint32Array(PALETTE_ENTRIES);
  let any = false;
  for (let i = 0; i < pixels.length; i += 1) {
    if (mask.region[i] !== regionId) continue;
    counts[pixels[i]] += 1;
    any = true;
  }
  if (!any) return measureBrightness(palette, pixels);

  // measureBrightness works from a histogram of pixels, so hand it one built
  // from this region alone.
  const slice: number[] = [];
  for (let entry = 0; entry < PALETTE_ENTRIES; entry += 1) {
    if (counts[entry] > 0) slice.push(entry);
  }
  const synthetic = new Uint8Array(slice.reduce((sum, entry) => sum + counts[entry], 0));
  let at = 0;
  for (const entry of slice) {
    synthetic.fill(entry, at, at + counts[entry]);
    at += counts[entry];
  }
  return measureBrightness(palette, synthetic);
}


/** A finish per region, plus a pattern that varies it across the surface. */
export interface FinishLook {
  finishes: Record<number, Finish>;
  patternId: string;
  patternStrength: number;
}

/** True when nothing would change, so the original bytes can be kept. */
export function isUntouched(look: FinishLook, mask: RegionMask | null): boolean {
  const ids = mask && mask.present.length > 0 ? mask.present : [REGION_NONE];
  return ids.every((id) => (look.finishes[id] ?? ORIGINAL_FINISH).mode === "original");
}

/**
 * The finish path: each region gets its own treatment, and the value channel of
 * the source is carried through so the shading, bevels and engraving that make
 * the knife look like an object survive whatever colour lands on it.
 */
export function applyFinishes(
  model: MdlFile,
  texture: MdlTexture,
  mask: RegionMask | null,
  look: FinishLook,
): RecoloredTexture {
  const source = readPalette(model, texture);
  const pixels = readPixels(model, texture);
  const { width, height } = texture;

  const pattern = patternById(look.patternId);
  const shift = look.patternId === "none" ? 0 : look.patternStrength;

  const ids = mask && mask.present.length > 0 ? mask.present : [REGION_NONE];
  const bands = new Map<number, BrightnessRange>();
  for (const id of ids) bands.set(id, regionBand(source, pixels, mask, id));

  const rgb = new Uint8Array(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const slot = y * width + x;
      const entry = pixels[slot];
      const base: Rgb = [source[entry * 3], source[entry * 3 + 1], source[entry * 3 + 2]];

      const id = mask ? mask.region[slot] : REGION_NONE;
      if (mask && id === REGION_NONE) continue; // unused atlas space stays black

      const finish = look.finishes[id] ?? ORIGINAL_FINISH;
      if (finish.mode === "original") {
        for (let c = 0; c < 3; c += 1) rgb[slot * 3 + c] = base[c];
        continue;
      }

      const field =
        shift > 0
          ? pattern.field({
              x,
              y,
              width,
              height,
              along: mask ? mask.along[slot] / 255 : 0.5,
            })
          : 0.5;

      let color: Rgb;
      if (finish.mode === "tint") {
        // A pattern picks between the finish's two colours, which is what a
        // camo is: the same surface in two treatments, not a gradient.
        const blend = shift > 0 ? clamp01((field - 0.5) * shift * 2 + 0.5) : 0;
        color = applyTint(
          base,
          hexToHsv(finish.color, finish.color2, blend),
          finish.strength,
          finish.brightness,
        );
      } else {
        const band = bands.get(id) ?? bands.get(ids[0])!;
        const stops = finish.ramp.map((hex, i) => ({
          at: i / Math.max(1, finish.ramp.length - 1),
          color: hexToRgb(hex),
        }));
        const value = brightnessOf(source, entry);
        let t = clamp01((value - band.low) / (band.high - band.low));
        if (shift > 0) t = clamp01(t + (field - 0.5) * shift * 2);
        const sampled = sampleRamp(stops, t);
        const guard = clamp01(value / DEAD_SPACE_CUTOFF) * (1 + finish.brightness);
        color = [
          Math.min(255, Math.round(sampled[0] * guard)),
          Math.min(255, Math.round(sampled[1] * guard)),
          Math.min(255, Math.round(sampled[2] * guard)),
        ];
      }

      for (let c = 0; c < 3; c += 1) rgb[slot * 3 + c] = color[c];
    }
  }

  const quantized = quantize(rgb, width, height);
  return { texture, palette: quantized.palette, pixels: quantized.pixels };
}


/**
 * True when one finish covers the whole knife with no pattern. A tint depends
 * only on the colour a pixel already had, never on where it is, so that case
 * can stay in palette space: 768 bytes, exact, and fast enough for a slider.
 */
export function fitsPalettePath(look: FinishLook, mask: RegionMask | null): boolean {
  if (look.patternId !== "none" && look.patternStrength > 0) return false;

  const ids = mask && mask.present.length > 0 ? mask.present : [REGION_NONE];
  const finishes = ids.map((id) => look.finishes[id] ?? ORIGINAL_FINISH);
  if (finishes.some((finish) => finish.mode === "ramp")) return false;

  const first = JSON.stringify(finishes[0]);
  return finishes.every((finish) => JSON.stringify(finish) === first);
}

/** The palette-only path: retint the 256 entries and leave the pixels alone. */
export function applyFinishToPalette(
  model: MdlFile,
  texture: MdlTexture,
  finish: Finish,
): RecoloredTexture {
  const source = readPalette(model, texture);
  const palette = new Uint8Array(PALETTE_BYTES);

  if (finish.mode === "original") {
    palette.set(source);
    return { texture, palette };
  }

  const target = hexToHsv(finish.color, finish.color2, 0);
  for (let entry = 0; entry < PALETTE_ENTRIES; entry += 1) {
    const o = entry * 3;
    const tinted = applyTint(
      [source[o], source[o + 1], source[o + 2]],
      target,
      finish.strength,
      finish.brightness,
    );
    palette[o] = tinted[0];
    palette[o + 1] = tinted[1];
    palette[o + 2] = tinted[2];
  }
  return { texture, palette };
}
