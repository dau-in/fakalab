/**
 * Writes the texture atlas with a material applied, plus a zoom, so a pattern
 * can be compared against a real skin at the scale it actually lives at.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { MATERIALS } from "../src/data/materials";
import { isHandTexture } from "../src/mdl/parse";
import { applyFinishes } from "../src/mdl/recolor";
import { REGION_BLADE } from "../src/mdl/regions";
import { decodeToRgba, readPixels } from "../src/mdl/texture";
import { encodePng } from "./lib/png";
import { readMaskFile } from "./lib/read-mask";
import { loadModel } from "./lib/software-render";

const slug = process.argv[2] ?? "bayonet-knife";
const materialId = process.argv[3] ?? "digital";
const zoom = Number(process.argv[4] ?? 4);

const model = loadModel(join(process.cwd(), "public", "models", `${slug}.mdl`));
const mask = readMaskFile(join(process.cwd(), "public", "regions", `${slug}.png`));
const texture = model.textures.find((candidate) => !isHandTexture(candidate))!;
const material = MATERIALS.find((candidate) => candidate.id === materialId)!;

const recolored = applyFinishes(model, texture, mask, {
  finishes: { [REGION_BLADE]: { ...material.finish } },
});
const rgba = decodeToRgba(recolored.pixels ?? readPixels(model, texture), recolored.palette);

const { width, height } = texture;
const full = new Uint8Array(width * height * 3);
for (let i = 0; i < width * height; i += 1) {
  for (let c = 0; c < 3; c += 1) full[i * 3 + c] = rgba[i * 4 + c];
}

// Find the densest patch of blade to zoom into, so the crop lands on the part
// the material was applied to.
let bestX = 0;
let bestY = 0;
let best = -1;
const window = Math.floor(110 / zoom) * zoom;
for (let y = 0; y + window < height; y += 16) {
  for (let x = 0; x + window < width; x += 16) {
    let count = 0;
    for (let sy = y; sy < y + window; sy += 4) {
      for (let sx = x; sx < x + window; sx += 4) {
        if (mask.region[sy * width + sx] === REGION_BLADE) count += 1;
      }
    }
    if (count > best) {
      best = count;
      bestX = x;
      bestY = y;
    }
  }
}

const zoomSize = window * zoom;
const zoomed = new Uint8Array(zoomSize * zoomSize * 3);
for (let y = 0; y < zoomSize; y += 1) {
  for (let x = 0; x < zoomSize; x += 1) {
    const s = ((bestY + Math.floor(y / zoom)) * width + bestX + Math.floor(x / zoom)) * 3;
    const d = (y * zoomSize + x) * 3;
    for (let c = 0; c < 3; c += 1) zoomed[d + c] = full[s + c];
  }
}

const out = join(process.cwd(), "node_modules", ".tmp", `material-${materialId}.png`);
writeFileSync(out, encodePng(zoomSize, zoomSize, zoomed));
console.log(`${slug} · ${material.name} · crop ${bestX},${bestY} ${window}px x${zoom}`);
console.log(out);
