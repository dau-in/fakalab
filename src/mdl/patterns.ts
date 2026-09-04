/**
 * Surface patterns.
 *
 * A pattern belongs to one part of the knife, not to the knife. That was the
 * defect in the first version: the pattern lived on the whole look, so it fell
 * on every part that was not left alone and there was no way to put a camo on
 * the blade and nothing on the grip.
 *
 * The other thing the first version got wrong was the patterns themselves.
 * They were smooth fractal noise, which reads as fog. Looking closely at a
 * knife the maintainer had skinned by hand, its camo is hard-edged squares on
 * a grid in four flat tones, and the rivets of the model still show through
 * underneath. So a pattern here returns a field that is normally quantized to
 * a few hard steps, and the engine blends between two colours rather than
 * smearing brightness around.
 */

export interface PatternContext {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Position along the knife, 0 at the grip and 1 at the tip. */
  along: number;
}

export interface Pattern {
  id: string;
  name: string;
  field: (context: PatternContext) => number;
  /**
   * Hard steps to snap the field to. Zero leaves it smooth, which only suits
   * the patterns that are meant to be gradients.
   */
  levels: number;
  /** How strongly it separates the two colours by default, 0 to 1. */
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

/** Several octaves, which is what turns noise into marbling rather than fuzz. */
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

/** The side of a digital camo's squares, in texels. */
const BLOCK = 7;

export const PATTERNS: Pattern[] = [
  {
    id: "none",
    name: "Plain",
    levels: 0,
    strength: 0,
    field: () => 0.5,
  },
  {
    id: "digital",
    name: "Digital",
    // Sampling the noise per block rather than per texel is what makes the
    // squares flat, and four steps is what the reference camo uses.
    levels: 4,
    strength: 1,
    field: ({ x, y }) => fractal(Math.floor(x / BLOCK) / 5, Math.floor(y / BLOCK) / 5, 3),
  },
  {
    id: "woodland",
    name: "Woodland",
    // Larger patches with soft outlines snapped hard, the classic blotch camo.
    levels: 3,
    strength: 1,
    field: ({ x, y }) => fractal(x / 52, y / 52, 3),
  },
  {
    id: "carbon",
    name: "Carbon",
    // A twill weave: two interleaved diagonals on a fine grid.
    levels: 2,
    strength: 0.45,
    field: ({ x, y }) => {
      const cell = 4;
      const row = Math.floor(y / cell);
      const column = Math.floor(x / cell);
      return (row + column) % 2 === 0 ? 0.15 : 0.85;
    },
  },
  {
    id: "tiger",
    name: "Tiger",
    // Hard bands across the blade, wobbled so they are not mechanical.
    levels: 2,
    strength: 1,
    field: ({ x, y, along }) => {
      const wobble = fractal(x / 34, y / 34, 2) * 0.25;
      return (Math.sin((along + wobble) * 30) + 1) / 2;
    },
  },
  {
    id: "marble",
    name: "Marble",
    // Ridged noise: folding the field at its midpoint turns blobs into seams.
    levels: 0,
    strength: 0.8,
    field: ({ x, y }) => 1 - Math.abs(fractal(x / 62, y / 62) - 0.5) * 2,
  },
  {
    id: "fade",
    name: "Fade",
    // Straight down the knife, which is what the baked axis is for.
    levels: 0,
    strength: 1,
    field: ({ along }) => along,
  },
  {
    id: "worn",
    name: "Worn",
    // Wear collects toward the edge and the tip, so bias the noise by both.
    levels: 3,
    strength: 0.7,
    field: ({ x, y, along }) => {
      const grain = fractal(x / 16, y / 16, 4);
      return Math.min(1, Math.max(0, grain * 0.65 + along * 0.45));
    },
  },
  {
    id: "speckle",
    name: "Speckle",
    // Fine flecks, the anti-slip coating look.
    levels: 2,
    strength: 0.55,
    field: ({ x, y }) => hash(Math.floor(x / 2), Math.floor(y / 2)),
  },
];

export const DEFAULT_PATTERN = PATTERNS[0];

export function patternById(id: string): Pattern {
  return PATTERNS.find((pattern) => pattern.id === id) ?? DEFAULT_PATTERN;
}

/** Snaps a field to the pattern's hard steps, leaving smooth ones alone. */
export function quantizeField(value: number, levels: number): number {
  if (levels < 2) return value;
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return Math.min(levels - 1, Math.floor(clamped * levels)) / (levels - 1);
}
