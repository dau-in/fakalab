/**
 * Looks for usable regions inside a knife texture, without anyone painting a
 * mask by hand.
 *
 * A model's triangles carry UV coordinates, so rasterizing them marks exactly
 * which texels the knife actually shows. Those marks fall into disconnected
 * patches: the blade is laid out apart from the handle, the ring apart from
 * both. Labelling the connected components turns "which part of the knife" into
 * something the file already knows.
 *
 * Writes a map of the islands next to the texture so the split can be judged
 * by eye rather than by count.
 *
 *   npx esbuild scripts/analyze-uv-islands.ts --bundle --platform=node \
 *     --format=esm --outfile=node_modules/.tmp/islands.mjs
 *   node node_modules/.tmp/islands.mjs [slug]
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { KNIVES } from "../src/data/knives";
import { buildGeometry } from "../src/mdl/geometry";
import { isHandTexture, type MdlTexture } from "../src/mdl/parse";
import { decodeToRgba, readPalette, readPixels } from "../src/mdl/texture";
import { encodePng } from "./lib/png";
import { loadModel } from "./lib/software-render";

/** Islands smaller than this are seams and stray triangles, not parts. */
const MIN_ISLAND_TEXELS = 400;

/** Distinct hues for the map, enough that neighbours never share one. */
const ISLAND_COLORS: Array<[number, number, number]> = [
  [232, 161, 60],
  [80, 170, 235],
  [120, 210, 120],
  [230, 100, 130],
  [180, 130, 235],
  [235, 215, 90],
  [90, 220, 205],
  [235, 140, 70],
];

interface Island {
  id: number;
  texels: number;
}

/** Marks every texel covered by a triangle of the meshes using this texture. */
function usedTexels(
  meshes: ReturnType<typeof buildGeometry>["meshes"],
  texture: MdlTexture,
): Uint8Array {
  const { width, height } = texture;
  const used = new Uint8Array(width * height);

  for (const mesh of meshes) {
    if (mesh.texture.index !== texture.index) continue;

    for (let t = 0; t < mesh.triangleCount; t += 1) {
      const i0 = t * 3;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let k = 0; k < 3; k += 1) {
        xs.push(mesh.uvs[(i0 + k) * 2] * width);
        ys.push(mesh.uvs[(i0 + k) * 2 + 1] * height);
      }

      const minX = Math.max(0, Math.floor(Math.min(...xs)));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)));
      const minY = Math.max(0, Math.floor(Math.min(...ys)));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));

      const area =
        (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
      if (area === 0) continue;

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) / area;
          const w1 = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          used[y * width + x] = 1;
        }
      }
    }
  }
  return used;
}

/** Connected components over the used texels, four-way. */
function labelIslands(used: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(width * height).fill(-1);
  const islands: Island[] = [];
  const stack: number[] = [];

  for (let start = 0; start < used.length; start += 1) {
    if (!used[start] || labels[start] >= 0) continue;

    const id = islands.length;
    let texels = 0;
    stack.push(start);
    labels[start] = id;

    while (stack.length > 0) {
      const slot = stack.pop()!;
      texels += 1;
      const x = slot % width;
      const y = (slot / width) | 0;

      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const next = ny * width + nx;
        if (!used[next] || labels[next] >= 0) return;
        labels[next] = id;
        stack.push(next);
      };
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }

    islands.push({ id, texels });
  }

  return { labels, islands };
}

const only = process.argv[2];
const models = join(process.cwd(), "public", "models");
const outDir = join(process.cwd(), "node_modules", ".tmp");

console.log(
  "knife".padEnd(24) + "used%".padStart(7) + "islands".padStart(9) + "  largest parts",
);

for (const knife of KNIVES) {
  if (only && knife.slug !== only) continue;

  const model = loadModel(join(models, `${knife.slug}.mdl`));
  const geometry = buildGeometry(model);
  const texture = model.textures.find((candidate) => !isHandTexture(candidate));
  if (!texture) continue;

  const { width, height } = texture;
  const used = usedTexels(geometry.meshes, texture);
  const { labels, islands } = labelIslands(used, width, height);

  const real = islands.filter((island) => island.texels >= MIN_ISLAND_TEXELS);
  real.sort((a, b) => b.texels - a.texels);

  let usedCount = 0;
  for (let i = 0; i < used.length; i += 1) usedCount += used[i];

  console.log(
    knife.slug.padEnd(24) +
      `${((usedCount / used.length) * 100).toFixed(0)}%`.padStart(7) +
      String(real.length).padStart(9) +
      "  " +
      real
        .slice(0, 6)
        .map((island) => `${((island.texels / usedCount) * 100).toFixed(0)}%`)
        .join(" "),
  );

  if (only) {
    // Island map over a dimmed copy of the texture, for a human to judge.
    const rgba = decodeToRgba(readPixels(model, texture), readPalette(model, texture));
    const rank = new Map(real.map((island, index) => [island.id, index]));
    const out = new Uint8Array(width * height * 3);

    for (let slot = 0; slot < width * height; slot += 1) {
      const base = [rgba[slot * 4], rgba[slot * 4 + 1], rgba[slot * 4 + 2]];
      const index = rank.get(labels[slot]);
      const tint = index === undefined ? null : ISLAND_COLORS[index % ISLAND_COLORS.length];
      for (let c = 0; c < 3; c += 1) {
        out[slot * 3 + c] = tint ? base[c] * 0.35 + tint[c] * 0.65 : base[c] * 0.3;
      }
    }

    writeFileSync(join(outDir, `islands-${knife.slug}.png`), encodePng(width, height, out));
    console.log(`\n${real.length} islands mapped to ${outDir}\\islands-${knife.slug}.png`);
  }
}
