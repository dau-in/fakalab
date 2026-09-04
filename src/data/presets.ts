/**
 * Presets, as finishes per part rather than one colour over everything.
 *
 * The first version of this ramped the whole knife through a four-colour
 * gradient. It preserved the shading but flattened steel, handle scales and
 * fittings into a single colour family, and the result looked painted instead
 * of made of anything.
 *
 * Real skins are not like that, and neither was the knife the maintainer had
 * built by hand: it replaced the handle's purple with a grey camo and left the
 * blade's steel alone. So most presets here treat one part and leave the other
 * as it came, which is also why they read as knives.
 */

import { ORIGINAL_FINISH, type Finish } from "../mdl/finish";
import { REGION_BLADE, REGION_HANDLE } from "../mdl/regions";

export interface Preset {
  id: string;
  name: string;
  /** What each part gets. A missing part keeps its original material. */
  finishes: Record<number, Finish>;
  patternId: string;
  patternStrength: number;
}

const tint = (color: string, extra: Partial<Finish> = {}): Finish => ({
  ...ORIGINAL_FINISH,
  mode: "tint",
  color,
  ...extra,
});

const ramp = (stops: string[], extra: Partial<Finish> = {}): Finish => ({
  ...ORIGINAL_FINISH,
  mode: "ramp",
  ramp: stops,
  ...extra,
});

export const PRESETS: Preset[] = [
  {
    id: "original",
    name: "Original",
    finishes: {},
    patternId: "none",
    patternStrength: 0,
  },
  {
    id: "urban",
    name: "Urban",
    // The maintainer's own knife: grey digital camo on the grip, steel left be.
    finishes: { [REGION_HANDLE]: tint("#75796f", { color2: "#33362f" }) },
    patternId: "camo",
    patternStrength: 0.95,
  },
  {
    id: "forest",
    name: "Forest",
    finishes: {
      [REGION_HANDLE]: tint("#5c6b3a", { color2: "#2b3320" }),
      [REGION_BLADE]: tint("#3f4438", { strength: 0.5 }),
    },
    patternId: "camo",
    patternStrength: 0.9,
  },
  {
    id: "blued",
    name: "Blued",
    finishes: { [REGION_BLADE]: tint("#2b3a5c", { strength: 0.8, brightness: -0.05 }) },
    patternId: "none",
    patternStrength: 0,
  },
  {
    id: "tiger-tooth",
    name: "Tiger Tooth",
    finishes: {
      [REGION_BLADE]: tint("#d4a63c", { strength: 0.95, brightness: 0.08 }),
      [REGION_HANDLE]: tint("#2a2b27", { strength: 0.8 }),
    },
    patternId: "none",
    patternStrength: 0,
  },
  {
    id: "doppler",
    name: "Doppler",
    // A real Doppler is a blade finish, so the grip stays as it was.
    finishes: { [REGION_BLADE]: ramp(["#120a30", "#3a1d7a", "#2f6fc4", "#bfe4ff"]) },
    patternId: "marble",
    patternStrength: 0.55,
  },
  {
    id: "fade",
    name: "Fade",
    finishes: { [REGION_BLADE]: ramp(["#7a1b6a", "#d6357f", "#f08a2e", "#ffe98a"]) },
    patternId: "fade",
    patternStrength: 0.9,
  },
  {
    id: "crimson",
    name: "Crimson",
    finishes: {
      [REGION_HANDLE]: tint("#7a1f28", { strength: 0.9 }),
      [REGION_BLADE]: tint("#2c2c2e", { strength: 0.6 }),
    },
    patternId: "none",
    patternStrength: 0,
  },
  {
    id: "bone",
    name: "Bone",
    finishes: { [REGION_HANDLE]: tint("#d8cdb4", { strength: 0.85, brightness: 0.1 }) },
    patternId: "none",
    patternStrength: 0,
  },
  {
    id: "slate",
    name: "Slate",
    finishes: {
      [REGION_HANDLE]: tint("#4a5057", { strength: 0.9 }),
      [REGION_BLADE]: tint("#6c757d", { strength: 0.55 }),
    },
    patternId: "none",
    patternStrength: 0,
  },
];

export const DEFAULT_PRESET = PRESETS[1];

/** Fills in the parts a preset leaves alone. */
export function finishesOf(preset: Preset, regions: number[]): Record<number, Finish> {
  const out: Record<number, Finish> = {};
  for (const id of regions.length > 0 ? regions : [REGION_HANDLE]) {
    out[id] = preset.finishes[id] ?? ORIGINAL_FINISH;
  }
  return out;
}
