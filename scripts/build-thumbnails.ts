/**
 * Renders a thumbnail of each knife for the picker.
 *
 * The rail used to show one generic icon twenty-one times, which is no help
 * when the whole choice is which shape you want. These come out of the actual
 * models through the same software renderer the offline checks use, so a
 * thumbnail is the knife, not an illustration of it.
 *
 * Hand meshes are skipped: at this size arms would fill the frame and hide the
 * only thing being chosen. The pose is picked per knife by rendering several
 * frames of the idle animation and keeping whichever turns the most blade
 * toward the camera.
 *
 *   npm run thumbnails
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { idleSequence } from "../src/mdl/animation";
import { KNIVES } from "../src/data/knives";
import { DEFAULT_GAMMA } from "../src/mdl/gamma";
import { isHandTexture } from "../src/mdl/parse";
import { encodePng } from "./lib/png";
import { buildGeometry, loadModel, render } from "./lib/software-render";

const WIDTH = 1366;
const HEIGHT = 768;
const SIZE = 64;
const PADDING = 2;

/** Flat enough to read as a silhouette, lit enough to show the bevels. */
const LIGHTING = {
  ambient: 95,
  shade: 140,
  direction: [0.2, 0.6, -0.75] as [number, number, number],
  gamma: DEFAULT_GAMMA,
};

/** Spread across the animation so at least one pose shows the blade side on. */
const CANDIDATE_FRAMES = [0, 12, 24, 36, 48, 60, 75, 90, 110, 130];

interface Cropped {
  rgba: Uint8Array;
  width: number;
  height: number;
}

/** Trims to the drawn pixels and letterboxes into a square with alpha. */
function toThumbnail(rgb: Uint8Array, coverage: Uint8Array): Cropped | null {
  let minX = WIDTH;
  let minY = HEIGHT;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (!coverage[y * WIDTH + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const span = Math.max(cropW, cropH);
  const scale = span / (SIZE - PADDING * 2);

  const out = new Uint8Array(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      // Box filter over the source pixels this thumbnail pixel covers.
      const sx0 = minX + (x - PADDING) * scale - (span - cropW) / 2;
      const sy0 = minY + (y - PADDING) * scale - (span - cropH) / 2;
      const sx1 = sx0 + scale;
      const sy1 = sy0 + scale;

      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      let total = 0;

      for (let sy = Math.floor(sy0); sy < sy1; sy += 1) {
        for (let sx = Math.floor(sx0); sx < sx1; sx += 1) {
          if (sx < 0 || sy < 0 || sx >= WIDTH || sy >= HEIGHT) continue;
          total += 1;
          const slot = sy * WIDTH + sx;
          if (!coverage[slot]) continue;
          hits += 1;
          r += rgb[slot * 3];
          g += rgb[slot * 3 + 1];
          b += rgb[slot * 3 + 2];
        }
      }

      const o = (y * SIZE + x) * 4;
      if (hits === 0 || total === 0) continue;
      out[o] = r / hits;
      out[o + 1] = g / hits;
      out[o + 2] = b / hits;
      // Partial coverage becomes partial alpha, which is the antialiasing.
      out[o + 3] = Math.round((hits / total) * 255);
    }
  }

  return { rgba: out, width: SIZE, height: SIZE };
}

const models = join(process.cwd(), "public", "models");
const target = join(process.cwd(), "public", "thumbs");
await mkdir(target, { recursive: true });

console.log("knife".padEnd(24) + "frame".padStart(6) + "pixels".padStart(9) + "size".padStart(8));

for (const knife of KNIVES) {
  const model = loadModel(join(models, `${knife.slug}.mdl`));
  const geometry = buildGeometry(model);
  const sequence = idleSequence(model);
  if (!sequence) throw new Error(`${knife.slug} has no sequences`);

  let best: { frame: number; area: number; rgb: Uint8Array; coverage: Uint8Array } | null = null;

  for (const frame of CANDIDATE_FRAMES) {
    if (frame >= sequence.numFrames) continue;
    const result = render({
      model,
      geometry,
      sequence,
      frame,
      lighting: LIGHTING,
      width: WIDTH,
      height: HEIGHT,
      only: (texture) => !isHandTexture(texture),
    });

    let area = 0;
    for (let i = 0; i < result.coverage.length; i += 1) area += result.coverage[i];
    if (!best || area > best.area) {
      best = { frame, area, rgb: result.rgb, coverage: result.coverage };
    }
  }

  if (!best) throw new Error(`${knife.slug} rendered nothing`);
  const thumbnail = toThumbnail(best.rgb, best.coverage);
  if (!thumbnail) throw new Error(`${knife.slug} produced an empty thumbnail`);

  const png = encodePng(thumbnail.width, thumbnail.height, thumbnail.rgba, 4);
  await writeFile(join(target, `${knife.slug}.png`), png);

  console.log(
    knife.slug.padEnd(24) +
      String(best.frame).padStart(6) +
      String(best.area).padStart(9) +
      `${png.length} B`.padStart(8),
  );
}

console.log(`\n${KNIVES.length} thumbnails in public/thumbs`);
