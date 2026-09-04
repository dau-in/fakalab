/**
 * Spatial patterns.
 *
 * A pattern returns a value from 0 to 1 for a texel, and the recolor engine
 * uses it to shift where that texel sits along its ramp. Since a ramp already
 * runs through several colours, shifting the lookup changes hue as well as
 * brightness, which is how a fade ends up magenta at one end and yellow at the
 * other without anyone specifying a second colour scheme.
 *
 * `along` is how far up the knife a texel sits, grip at 0 and tip at 1, baked
 * into the region mask at curation time. Patterns that mean something on the
 * object rather than on the atlas use it: a fade in UV space would run diagonally
 * across a sheet of unrelated pieces and read as nothing.
 */

export interface PatternContext {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Position along the knife, 0 at the grip and 1 at the tip. */
  along: number;
}

export type PatternField = (context: PatternContext) => number;

export interface Pattern {
  id: string;
  name: string;
  field: PatternField;
  /** How far it shifts the ramp by default, 0 to 1. */
  strength: number;
}

/** Deterministic hash noise, so a pattern is the same on every machine. */
function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise: hashed lattice with smooth interpolation between corners. */
function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);

  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);

  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Several octaves, which is what makes noise read as marbling rather than fuzz. */
function fractal(x: number, y: number, octaves = 4): number {
  let value = 0;
  let amplitude = 1;
  let total = 0;

  for (let i = 0; i < octaves; i += 1) {
    value += noise(x, y) * amplitude;
    total += amplitude;
    x *= 2.07;
    y *= 2.03;
    amplitude *= 0.5;
  }
  return value / total;
}

export const PATTERNS: Pattern[] = [
  {
    id: "none",
    name: "Solid",
    strength: 0,
    field: () => 0.5,
  },
  {
    id: "fade",
    name: "Fade",
    strength: 0.85,
    // Straight down the knife, which is the whole point of the baked axis.
    field: ({ along }) => along,
  },
  {
    id: "marble",
    name: "Marble",
    strength: 0.7,
    field: ({ x, y }) => fractal(x / 90, y / 90),
  },
  {
    id: "veins",
    name: "Veins",
    strength: 0.75,
    // Ridged noise: folding the field at its midpoint turns smooth blobs into
    // the sharp seams a marbled surface actually has.
    field: ({ x, y }) => 1 - Math.abs(fractal(x / 70, y / 70) - 0.5) * 2,
  },
  {
    id: "tiger",
    name: "Tiger",
    strength: 0.8,
    // Bands across the blade, wobbled so they are not mechanical.
    field: ({ x, y, along }) => {
      const wobble = fractal(x / 40, y / 40) * 0.22;
      return smoothstep(Math.min(1, Math.max(0, (Math.sin((along + wobble) * 34) + 1) / 2)));
    },
  },
  {
    id: "camo",
    name: "Camo",
    strength: 0.9,
    // Coarse noise pushed toward its extremes, so it reads as patches.
    field: ({ x, y }) => {
      const value = fractal(x / 45, y / 45, 3);
      return value < 0.42 ? 0 : value > 0.58 ? 1 : (value - 0.42) / 0.16;
    },
  },
  {
    id: "scales",
    name: "Scales",
    strength: 0.6,
    field: ({ x, y }) => {
      const row = Math.floor(y / 14);
      const offset = row % 2 === 0 ? 0 : 7;
      const dx = ((x + offset) % 14) / 14 - 0.5;
      const dy = (y % 14) / 14 - 0.5;
      return Math.min(1, Math.hypot(dx, dy) * 2.4);
    },
  },
];

export const DEFAULT_PATTERN = PATTERNS[0];

export function patternById(id: string): Pattern {
  return PATTERNS.find((pattern) => pattern.id === id) ?? DEFAULT_PATTERN;
}
