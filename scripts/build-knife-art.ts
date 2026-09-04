/**
 * Draws every knife in the picker's flat style, from the models themselves.
 *
 * The style was set by hand on the project's own icon: flat shapes, five
 * materials, no gradients. Doing that twenty-one times by hand would be slow
 * and inconsistent, and rendered photographs of the models read as small dark
 * smudges in a list and cannot follow the theme.
 *
 * So the models are rendered knife-only, and every drawn pixel is sorted into
 * one of the five materials using two things the file already knows: which
 * part it belongs to, from the region mask, and how lit it is. A blade's lit
 * face and its shadowed bevel become two flat tones, its brightest sliver
 * becomes the edge, and the grip splits the same way.
 *
 * Every knife is then turned to the same angle, tip up and to the right. The
 * pose that shows the most blade points somewhere different on each model, and
 * a list of knives all lying at their own angle reads as a pile rather than a
 * set. An axis has no direction of its own, so the blade's own centroid decides
 * which end is the tip.
 *
 * The result is written with the material index in the red channel rather than
 * a colour, so the app can paint it in whatever the current theme is. Indices
 * are spaced across the byte rather than counted from zero, because the browser
 * reads them back through a canvas and a canvas may colour-manage what it is
 * given; adjacent values would not survive that.
 *
 *   npm run knife-art
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { idleSequence } from "../src/mdl/animation";
import { KNIVES } from "../src/data/knives";
import { DEFAULT_GAMMA } from "../src/mdl/gamma";
import { isHandTexture } from "../src/mdl/parse";
import { REGION_BLADE, REGION_HANDLE } from "../src/mdl/regions";
import { encodePng } from "./lib/png";
import { readMaskFile } from "./lib/read-mask";
import { buildGeometry, loadModel, render } from "./lib/software-render";

/** Material indices, matching the app's own list. */
const NONE = 0;
const FACE = 1;
const BEVEL = 2;
const GRIP = 3;
const GRIT = 4;
const EDGE = 5;

/** Spacing that keeps the indices apart once a canvas has been near them. */
const MATERIAL_STEP = 51;

const RENDER = 1280;
const SIZE = 64;
const PADDING = 3;

/** Where every knife's long axis is pointed, up and to the right. */
const TARGET_ANGLE = -Math.PI / 4;

/** Flat and frontal, so the shapes read rather than the shading. */
const LIGHTING = {
  ambient: 120,
  shade: 120,
  direction: [0.15, 0.55, -0.8] as [number, number, number],
  gamma: DEFAULT_GAMMA,
};

const CANDIDATE_FRAMES = [0, 12, 24, 36, 48, 60, 75, 90, 110, 130];

/** How close in size a second shape has to be before it counts as a twin. */
const PAIR_SHARE = 0.6;

function luminance(rgb: Uint8Array, slot: number): number {
  return rgb[slot * 3] * 0.299 + rgb[slot * 3 + 1] * 0.587 + rgb[slot * 3 + 2] * 0.114;
}

/** The value at a fraction through a sorted copy of the samples. */
function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

/**
 * Blanks every drawn shape but the largest, and only when the second largest is
 * nearly as big — a knife whose guard or pommel comes out as its own small
 * shape keeps all of them, a pair of daggers keeps one.
 */
function keepLargestOfPair(material: Uint8Array): void {
  const label = new Int32Array(material.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];

  for (let start = 0; start < material.length; start += 1) {
    if (!material[start] || label[start] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    label[start] = id;
    stack.push(start);

    while (stack.length > 0) {
      const slot = stack.pop() as number;
      size += 1;
      const x = slot % RENDER;
      const y = (slot / RENDER) | 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= RENDER || ny >= RENDER) continue;
          const next = ny * RENDER + nx;
          if (material[next] && label[next] < 0) {
            label[next] = id;
            stack.push(next);
          }
        }
      }
    }
    sizes.push(size);
  }

  if (sizes.length < 2) return;
  const order = sizes.map((size, id) => ({ size, id })).sort((a, b) => b.size - a.size);
  if (order[1].size < order[0].size * PAIR_SHARE) return;

  const keep = order[0].id;
  for (let slot = 0; slot < material.length; slot += 1) {
    if (label[slot] >= 0 && label[slot] !== keep) material[slot] = NONE;
  }
}

const models = join(process.cwd(), "public", "models");
const masks = join(process.cwd(), "public", "regions");
const target = join(process.cwd(), "public", "art");
await mkdir(target, { recursive: true });

console.log("knife".padEnd(24) + "frame".padStart(6) + "materials".padStart(11) + "size".padStart(8));

for (const knife of KNIVES) {
  const model = loadModel(join(models, `${knife.slug}.mdl`));
  const geometry = buildGeometry(model);
  const sequence = idleSequence(model);
  if (!sequence) throw new Error(`${knife.slug} has no sequences`);

  const mask = readMaskFile(join(masks, `${knife.slug}.png`));
  const texture = model.textures.find((candidate) => !isHandTexture(candidate));
  if (!texture) continue;

  // The pose that shows the most blade, same rule the thumbnails use.
  let best: ReturnType<typeof render> | null = null;
  let bestFrame = 0;
  let bestArea = -1;

  for (const frame of CANDIDATE_FRAMES) {
    if (frame >= sequence.numFrames) continue;
    const result = render({
      model,
      geometry,
      sequence,
      frame,
      lighting: LIGHTING,
      width: RENDER,
      height: RENDER,
      only: (candidate) => !isHandTexture(candidate),
      regions: { width: mask.width, height: mask.height, region: mask.region },
    });

    let area = 0;
    for (let i = 0; i < result.coverage.length; i += 1) area += result.coverage[i];
    if (area > bestArea) {
      bestArea = area;
      bestFrame = frame;
      best = result;
    }
  }
  if (!best) throw new Error(`${knife.slug} rendered nothing`);

  // Each part is split into a lit tone and a shadowed one at its own median,
  // so a dark knife and a bright one both come out as two readable tones.
  const bladeLuma: number[] = [];
  const handleLuma: number[] = [];
  for (let slot = 0; slot < best.coverage.length; slot += 1) {
    if (!best.coverage[slot]) continue;
    const value = luminance(best.rgb, slot);
    if (best.region[slot] === REGION_BLADE) bladeLuma.push(value);
    else handleLuma.push(value);
  }

  // The gut knife and the shadow daggers are one region throughout, so there
  // is no grip to tell apart and every pixel is drawn as blade.
  const splitByPart = bladeLuma.length > 0 && handleLuma.length > 0;
  const allLuma = splitByPart ? bladeLuma : [...bladeLuma, ...handleLuma];

  const bladeMid = percentile(allLuma, 0.5);
  const bladeHigh = percentile(allLuma, 0.94);
  const handleMid = percentile(handleLuma, 0.55);

  const material = new Uint8Array(RENDER * RENDER);
  for (let slot = 0; slot < best.coverage.length; slot += 1) {
    if (!best.coverage[slot]) continue;
    const value = luminance(best.rgb, slot);

    // A knife with no blade/handle split of its own is drawn as all blade, so
    // it still reads as a knife rather than a lump of grip.
    if (splitByPart && best.region[slot] === REGION_HANDLE) {
      material[slot] = value > handleMid ? GRIT : GRIP;
    } else {
      // Only a sliver is the sharpened edge; the rest is face or bevel.
      material[slot] = value >= bladeHigh ? EDGE : value > bladeMid ? FACE : BEVEL;
    }
  }

  // The shadow daggers are two knives, one in each hand, so the drawing would
  // frame both and leave each of them a fifth the size of every other knife in
  // the list. Where a model turns out to be a matched pair, only the larger
  // half is drawn, and the set stays at one knife per row.
  keepLargestOfPair(material);

  // The knife's own long axis, from the spread of its drawn pixels, so every
  // one of them can be turned to the same angle.
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < RENDER; y += 1) {
    for (let x = 0; x < RENDER; x += 1) {
      if (!material[y * RENDER + x]) continue;
      sumX += x;
      sumY += y;
      count += 1;
    }
  }
  const centreX = sumX / count;
  const centreY = sumY / count;

  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let y = 0; y < RENDER; y += 1) {
    for (let x = 0; x < RENDER; x += 1) {
      if (!material[y * RENDER + x]) continue;
      const dx = x - centreX;
      const dy = y - centreY;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
    }
  }
  let axis = 0.5 * Math.atan2(2 * xy, xx - yy);

  // A principal axis points both ways. The blade sits at the tip end, so its
  // centroid relative to the grip's says which way round to hang the knife.
  let bladeX = 0;
  let bladeY = 0;
  let blades = 0;
  let gripX = 0;
  let gripY = 0;
  let grips = 0;
  for (let y = 0; y < RENDER; y += 1) {
    for (let x = 0; x < RENDER; x += 1) {
      const value = material[y * RENDER + x];
      if (value === FACE || value === BEVEL || value === EDGE) {
        bladeX += x;
        bladeY += y;
        blades += 1;
      } else if (value === GRIP || value === GRIT) {
        gripX += x;
        gripY += y;
        grips += 1;
      }
    }
  }
  if (blades > 0 && grips > 0) {
    const towardTip =
      Math.cos(axis) * (bladeX / blades - gripX / grips) +
      Math.sin(axis) * (bladeY / blades - gripY / grips);
    if (towardTip < 0) axis += Math.PI;
  }

  // Turn that axis onto the diagonal, which is where the project's own icon
  // sits and what leaves the most room in a square.
  const turn = axis - TARGET_ANGLE;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const project = (x: number, y: number) => {
    const dx = x - centreX;
    const dy = y - centreY;
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  };

  // Bounds in the turned frame, so the crop follows the rotation.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < RENDER; y += 1) {
    for (let x = 0; x < RENDER; x += 1) {
      if (!material[y * RENDER + x]) continue;
      const point = project(x, y);
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
  }

  const span = Math.max(maxX - minX, maxY - minY);
  const scale = span / (SIZE - PADDING * 2);
  const offsetX = (minX + maxX) / 2 - (span / 2) - PADDING * scale;
  const offsetY = (minY + maxY) / 2 - (span / 2) - PADDING * scale;

  const out = new Uint8Array(SIZE * SIZE * 3);
  const seen = new Set<number>();
  const step = Math.max(1, Math.floor(scale / 3));

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const votes = [0, 0, 0, 0, 0, 0];

      // Sample the cell in the turned frame and map each sample back.
      for (let sy = 0; sy < scale; sy += step) {
        for (let sx = 0; sx < scale; sx += step) {
          const tx = offsetX + x * scale + sx;
          const ty = offsetY + y * scale + sy;
          const ox = Math.round(centreX + tx * cos - ty * sin);
          const oy = Math.round(centreY + tx * sin + ty * cos);
          if (ox < 0 || oy < 0 || ox >= RENDER || oy >= RENDER) continue;
          votes[material[oy * RENDER + ox]] += 1;
        }
      }

      // Background only wins if it holds most of the cell, which keeps thin
      // parts of the knife from being eroded away.
      let winner = NONE;
      let count = 0;
      for (let i = 1; i < votes.length; i += 1) {
        if (votes[i] > count) {
          count = votes[i];
          winner = i;
        }
      }
      const total = votes.reduce((sum, value) => sum + value, 0);
      if (count * 3 < total) winner = NONE;

      out[(y * SIZE + x) * 3] = winner * MATERIAL_STEP;
      seen.add(winner);
    }
  }

  const png = encodePng(SIZE, SIZE, out);
  await writeFile(join(target, `${knife.slug}.png`), png);

  console.log(
    knife.slug.padEnd(24) +
      String(bestFrame).padStart(6) +
      String(seen.size - 1).padStart(11) +
      `${png.length} B`.padStart(8),
  );
}

console.log(`\n${KNIVES.length} drawings in public/art`);
