/**
 * The material library: what a part of a knife can be finished in.
 *
 * These replaced whole-knife presets, which was the wrong unit. A preset that
 * covered the entire knife flattened steel, scales and fittings into one
 * colour family and looked painted; and a pattern that came with it landed
 * everywhere at once. Real skins treat one part at a time, so that is what you
 * pick here: choose the blade or the grip, choose what it is made of, choose
 * its colours.
 *
 * Every material keeps the value channel of whatever was underneath, so the
 * model's bevels, rivets and engraving read through all of them.
 */

import { ORIGINAL_FINISH, type Finish } from "../mdl/finish";

export interface Material {
  id: string;
  name: string;
  /** What the material does, before the user picks its colours. */
  finish: Finish;
  /** Whether the second colour does anything, which decides the UI. */
  twoTone: boolean;
}

const make = (patch: Partial<Finish>): Finish => ({ ...ORIGINAL_FINISH, mode: "tint", ...patch });

export const MATERIALS: Material[] = [
  {
    id: "original",
    name: "As it came",
    finish: { ...ORIGINAL_FINISH },
    twoTone: false,
  },
  {
    id: "solid",
    name: "Solid",
    finish: make({ color: "#5a6472", patternId: "none", patternStrength: 0 }),
    twoTone: false,
  },
  {
    id: "digital",
    name: "Digital camo",
    // The reference: hard squares on a grid in a few flat tones.
    finish: make({
      color: "#7c8078",
      color2: "#26291f",
      patternId: "digital",
      patternStrength: 1,
    }),
    twoTone: true,
  },
  {
    id: "woodland",
    name: "Woodland",
    finish: make({
      color: "#5d6b39",
      color2: "#2a2f1e",
      patternId: "woodland",
      patternStrength: 1,
    }),
    twoTone: true,
  },
  {
    id: "carbon",
    name: "Carbon",
    finish: make({
      color: "#3a3d42",
      color2: "#191b1e",
      patternId: "carbon",
      patternStrength: 0.45,
    }),
    twoTone: true,
  },
  {
    id: "tiger",
    name: "Tiger",
    finish: make({
      color: "#d4a63c",
      color2: "#241d10",
      patternId: "tiger",
      patternStrength: 1,
    }),
    twoTone: true,
  },
  {
    id: "marble",
    name: "Marble",
    finish: make({
      color: "#6a3fb0",
      color2: "#2b6fc8",
      patternId: "marble",
      patternStrength: 0.8,
    }),
    twoTone: true,
  },
  {
    id: "worn",
    name: "Worn",
    finish: make({
      color: "#8a7f6a",
      color2: "#3b352b",
      patternId: "worn",
      patternStrength: 0.7,
      strength: 0.75,
    }),
    twoTone: true,
  },
  {
    id: "speckle",
    name: "Speckle",
    finish: make({
      color: "#43474b",
      color2: "#8e948f",
      patternId: "speckle",
      patternStrength: 0.55,
    }),
    twoTone: true,
  },
  {
    id: "fade",
    name: "Fade",
    // A gradient is a ramp rather than two colours, and it runs along the
    // knife because the axis is baked into the region mask.
    finish: {
      ...ORIGINAL_FINISH,
      mode: "ramp",
      ramp: ["#7a1b6a", "#d6357f", "#f08a2e", "#ffe98a"],
      patternId: "fade",
      patternStrength: 1,
    },
    twoTone: false,
  },
];

export const DEFAULT_MATERIAL = MATERIALS[0];

/** Which material a finish came from, for showing the current selection. */
export function materialOf(finish: Finish): string {
  if (finish.mode === "original") return "original";
  const match = MATERIALS.find(
    (material) =>
      material.finish.mode === finish.mode && material.finish.patternId === finish.patternId,
  );
  return match?.id ?? "custom";
}

export function materialById(id: string): Material | undefined {
  return MATERIALS.find((material) => material.id === id);
}
