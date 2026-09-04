/**
 * How a part of a knife gets its colour.
 *
 * The first attempt at this mapped brightness onto a multi-colour ramp across
 * the whole knife. It preserved the shading, but it also flattened steel, the
 * handle scales and the metal fittings onto one colour family, so everything
 * came out looking painted rather than made of anything. Comparing it against
 * a knife the maintainer had actually skinned by hand made the difference
 * obvious: that one replaced the handle's purple with a grey camo and left the
 * blade's steel alone.
 *
 * So a finish applies to one region, and the useful ones keep the original
 * value channel untouched. Every bevel, rivet, panel line and bit of baked
 * shading is carried in that channel; hue and saturation are what a skin
 * actually changes. This is the approach that was validated by eye in the
 * original reverse-engineering session, before ramps were introduced.
 */

export type Rgb = [number, number, number];

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === red) h = ((green - blue) / delta) % 6;
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ];
}

export type FinishMode = "original" | "tint" | "ramp";

export interface Finish {
  mode: FinishMode;
  /** Target colour for a tint. */
  color: string;
  /** The colour the pattern alternates with. */
  color2: string;
  /** Ramp stops, only for the ramp mode. */
  ramp: string[];
  /**
   * The surface texture, and how hard it separates the two colours. These
   * belong to the part rather than to the knife: a camo on the blade must be
   * able to leave the grip alone.
   */
  patternId: string;
  patternStrength: number;
  /**
   * How much of the target's hue and saturation to take, 0 to 1. Below 1 the
   * original material shows through, which is how a blued steel or a stained
   * wood keeps looking like itself.
   */
  strength: number;
  /** Lifts or drops the whole part without touching its internal contrast. */
  brightness: number;
}

/** The tint target, optionally mixed toward a second colour by a pattern. */
export function hexToHsv(hex: string, second: string | undefined, blend: number): Hsv {
  const first = parseHex(hex);
  if (!second || blend <= 0) return rgbToHsv(first[0], first[1], first[2]);

  const other = parseHex(second);
  const mixed: Rgb = [
    first[0] + (other[0] - first[0]) * blend,
    first[1] + (other[1] - first[1]) * blend,
    first[2] + (other[2] - first[2]) * blend,
  ];
  return rgbToHsv(mixed[0], mixed[1], mixed[2]);
}

function parseHex(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export const ORIGINAL_FINISH: Finish = {
  mode: "original",
  color: "#8a8f88",
  color2: "#3a3f38",
  ramp: ["#20241f", "#4a5147", "#7d857a", "#c9cfc4"],
  patternId: "none",
  patternStrength: 0,
  strength: 1,
  brightness: 0,
};

/** Whether this finish changes colour from place to place rather than by value. */
export function isPatterned(finish: Finish): boolean {
  return finish.mode !== "original" && finish.patternId !== "none" && finish.patternStrength > 0;
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Applies a finish colour to one source colour.
 *
 * The first version of this kept the source's value untouched and replaced
 * only hue and saturation. That preserved the shading, but it also meant a
 * colour could never change how light a surface is, so painting a dark blade
 * red gave dark red, and a camo made of four greys was invisible: the
 * difference between its patches is lightness, and lightness was exactly what
 * could not move.
 *
 * So the target's own value is used, offset by how far this pixel sits from its
 * surroundings. A rivet that was darker than its neighbours stays darker; a
 * highlight stays a highlight. The detail survives while the surface genuinely
 * takes the new colour.
 *
 * That offset is added, not multiplied. Multiplying was the first attempt and
 * it fell apart on dark knives: with a texture living between 0.02 and 0.38,
 * its brightest pixels are nineteen times its darkest, so anything above the
 * average was scaled straight into white and the knife came out blown out
 * rather than painted. Adding a deviation measured against the texture's own
 * spread gives every knife the same amount of visible detail, bright or dark.
 *
 * `band` is the value range the region actually occupies, and `strength` mixes
 * the whole result back toward the original, which is the difference between a
 * repaint and a wash.
 */
/** How much of the model's own light and shade survives a full-strength finish. */
const DETAIL = 0.85;

export function applyTint(
  source: Rgb,
  target: Hsv,
  strength: number,
  brightness: number,
  band: { low: number; high: number },
): Rgb {
  const original = rgbToHsv(source[0], source[1], source[2]);

  // Hue has no meaning on a grey pixel, so blending toward the source hue
  // there would swing the result around arbitrarily. Take the target's.
  const hue = original.s < 0.04 ? target.h : mixHue(original.h, target.h, strength);
  const saturation = original.s + (target.s - original.s) * strength;

  // Where this pixel sits within its own texture's range, roughly -0.5 to 0.5.
  const spread = Math.max(0.12, band.high - band.low);
  const middle = (band.low + band.high) / 2;
  const deviation = Math.min(0.75, Math.max(-0.75, (original.v - middle) / spread));

  const painted = clamp01(target.v + deviation * DETAIL);
  const value = clamp01((original.v + (painted - original.v) * strength) * (1 + brightness));

  return hsvToRgb(hue, clamp01(saturation), value);
}

/** Interpolates around the colour wheel the short way. */
function mixHue(from: number, to: number, amount: number): number {
  let delta = to - from;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const result = from + delta * amount;
  return ((result % 360) + 360) % 360;
}
