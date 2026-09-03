/**
 * Presets are color ramps: four stops running from the deepest shadow of the
 * texture to its brightest highlight.
 *
 * Names follow what the community already calls these looks, so players
 * recognize them without a legend.
 */

import { hexToRgb, type RampStop } from "../mdl/recolor";

export interface Preset {
  id: string;
  name: string;
  /** Hex stops, shadow first. */
  colors: [string, string, string, string];
}

export const PRESETS: Preset[] = [
  { id: "vanilla", name: "Vanilla", colors: ["#20241f", "#4a5147", "#7d857a", "#c9cfc4"] },
  { id: "doppler", name: "Doppler", colors: ["#080a28", "#461e96", "#2878dc", "#beebff"] },
  { id: "fade", name: "Fade", colors: ["#460a3c", "#e1288c", "#fa8c28", "#fff596"] },
  { id: "tiger-tooth", name: "Tiger Tooth", colors: ["#2d1e05", "#8a6413", "#be8c19", "#fff0b4"] },
  { id: "ultraviolet", name: "Ultraviolet", colors: ["#120a20", "#3a1c6e", "#6b3fb8", "#c9a6ff"] },
  { id: "crimson", name: "Crimson", colors: ["#1c0505", "#7a1414", "#c22b2b", "#ffb0a0"] },
  { id: "slate", name: "Slate", colors: ["#15181c", "#333d47", "#5d6b78", "#b6c2cd"] },
  { id: "emerald", name: "Emerald", colors: ["#04160f", "#0d5238", "#1c9668", "#a8f0cf"] },
];

/** Even spacing across the ramp; a preset's own curve comes from its colors. */
export function toStops(colors: readonly string[]): RampStop[] {
  const last = colors.length - 1;
  return colors.map((hex, i) => ({ at: last === 0 ? 0 : i / last, color: hexToRgb(hex) }));
}

export const DEFAULT_PRESET = PRESETS[1];
