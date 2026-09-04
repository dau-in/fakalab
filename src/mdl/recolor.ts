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
import { patternById, type Pattern } from "./patterns";
import { quantize } from "./quantize";
import { REGION_NONE, type RegionMask } from "./regions";

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

/**
 * Builds the replacement palette for one texture. Returns 768 bytes ready to
 * be written straight over the original.
 */
export function buildPalette(
  source: Uint8Array,
  pixels: Uint8Array,
  stops: RampStop[],
  adjust: Adjust = NEUTRAL_ADJUST,
): Uint8Array {
  const { low, high } = measureBrightness(source, pixels);
  const span = high - low;

  // Contrast bends the ramp lookup; brightness scales the result.
  const curve = Math.pow(2, -adjust.contrast);
  const gain = 1 + adjust.brightness;

  const result = new Uint8Array(PALETTE_BYTES);
  for (let entry = 0; entry < PALETTE_ENTRIES; entry += 1) {
    const value = brightnessOf(source, entry);
    const t = Math.pow(clamp01((value - low) / span), curve);
    const color = sampleRamp(stops, t);

    // Keep true black black: dead UV padding must not pick up the shadow color.
    const guard = clamp01(value / DEAD_SPACE_CUTOFF) * gain;

    const o = entry * 3;
    result[o] = Math.min(255, Math.round(color[0] * guard));
    result[o + 1] = Math.min(255, Math.round(color[1] * guard));
    result[o + 2] = Math.min(255, Math.round(color[2] * guard));
  }
  return result;
}

export interface RecoloredTexture {
  texture: MdlTexture;
  palette: Uint8Array;
  /** Rewritten indices, present only when the pixel path ran. */
  pixels?: Uint8Array;
}

/** Everything that decides what a knife ends up looking like. */
export interface Look {
  /** One ramp per region id. A single entry means the whole knife. */
  ramps: Record<number, RampStop[]>;
  adjust: Adjust;
  patternId: string;
  /** How far the pattern shifts the ramp lookup, 0 to 1. */
  patternStrength: number;
}

/** Whether a look needs the slower path that rewrites pixel indices. */
export function needsPixelPath(look: Look, mask: RegionMask | null): boolean {
  if (look.patternId !== "none" && look.patternStrength > 0) return true;
  if (!mask || mask.present.length < 2) return false;

  const ramps = mask.present.map((id) => JSON.stringify(look.ramps[id] ?? null));
  return ramps.some((ramp) => ramp !== ramps[0]);
}

/** Applies a preset to every knife texture, leaving the hand textures alone. */
export function recolorTextures(
  model: MdlFile,
  targets: MdlTexture[],
  stops: RampStop[],
  adjust: Adjust = NEUTRAL_ADJUST,
): RecoloredTexture[] {
  return targets.map((texture) => ({
    texture,
    palette: buildPalette(readPalette(model, texture), readPixels(model, texture), stops, adjust),
  }));
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

/**
 * The pixel path: colour per region, optional pattern, then back down to 256
 * colours. Returns new indices alongside the new palette.
 */
export function recolorPixelsOf(
  model: MdlFile,
  texture: MdlTexture,
  mask: RegionMask | null,
  look: Look,
): RecoloredTexture {
  const source = readPalette(model, texture);
  const pixels = readPixels(model, texture);
  const { width, height } = texture;

  const pattern: Pattern = patternById(look.patternId);
  const shift = look.patternId === "none" ? 0 : look.patternStrength;

  const bands = new Map<number, BrightnessRange>();
  const rampFor = new Map<number, RampStop[]>();
  const ids = mask && mask.present.length > 0 ? mask.present : [REGION_NONE];
  for (const id of ids) {
    bands.set(id, regionBand(source, pixels, mask, id));
    rampFor.set(id, look.ramps[id] ?? look.ramps[ids[0]] ?? []);
  }

  const curve = Math.pow(2, -look.adjust.contrast);
  const gain = 1 + look.adjust.brightness;
  const rgb = new Uint8Array(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const slot = y * width + x;
      const entry = pixels[slot];
      const value = brightnessOf(source, entry);

      const id = mask ? mask.region[slot] : REGION_NONE;
      if (mask && id === REGION_NONE) continue; // unused atlas space stays black

      const band = bands.get(id) ?? bands.get(ids[0])!;
      const stops = rampFor.get(id) ?? rampFor.get(ids[0])!;

      let t = Math.pow(clamp01((value - band.low) / (band.high - band.low)), curve);
      if (shift > 0) {
        const field = pattern.field({
          x,
          y,
          width,
          height,
          along: mask ? mask.along[slot] / 255 : 0.5,
        });
        // Centred so the pattern pushes both ways instead of only brightening.
        t = clamp01(t + (field - 0.5) * shift * 2);
      }

      const color = sampleRamp(stops, t);
      const guard = clamp01(value / DEAD_SPACE_CUTOFF) * gain;
      for (let c = 0; c < 3; c += 1) {
        rgb[slot * 3 + c] = Math.min(255, Math.round(color[c] * guard));
      }
    }
  }

  const quantized = quantize(rgb, width, height);
  return { texture, palette: quantized.palette, pixels: quantized.pixels };
}
