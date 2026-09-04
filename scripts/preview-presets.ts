/** Renders every shipped preset on one knife, cropped, to sanity-check them. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { idleSequence } from "../src/mdl/animation";
import { buildGeometry } from "../src/mdl/geometry";
import { DEFAULT_GAMMA } from "../src/mdl/gamma";
import { isHandTexture } from "../src/mdl/parse";
import { MATERIALS } from "../src/data/materials";
import { applyFinishes, type FinishLook } from "../src/mdl/recolor";
import { REGION_BLADE } from "../src/mdl/regions";
import { encodePng } from "./lib/png";
import { readMaskFile } from "./lib/read-mask";
import { loadModel, render } from "./lib/software-render";

const SIZE = 340;
const RENDER = 1200;
const slug = process.argv[2] ?? "talon-knife";

const model = loadModel(join(process.cwd(), "public", "models", `${slug}.mdl`));
const geometry = buildGeometry(model);
const sequence = idleSequence(model)!;
const mask = readMaskFile(join(process.cwd(), "public", "regions", `${slug}.png`));
const texture = model.textures.find((c) => !isHandTexture(c))!;

function crop(rgb: Uint8Array, coverage: Uint8Array): Uint8Array {
  let minX = RENDER, minY = RENDER, maxX = -1, maxY = -1;
  for (let y = 0; y < RENDER; y += 1)
    for (let x = 0; x < RENDER; x += 1) {
      if (!coverage[y * RENDER + x]) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  const out = new Uint8Array(SIZE * SIZE * 3);
  if (maxX < 0) return out;
  const span = Math.max(maxX - minX + 1, maxY - minY + 1);
  const scale = span / SIZE;
  const ox = minX - (span - (maxX - minX + 1)) / 2;
  const oy = minY - (span - (maxY - minY + 1)) / 2;
  for (let y = 0; y < SIZE; y += 1)
    for (let x = 0; x < SIZE; x += 1) {
      const sx = Math.round(ox + x * scale), sy = Math.round(oy + y * scale);
      if (sx < 0 || sy < 0 || sx >= RENDER || sy >= RENDER) continue;
      const s = (sy * RENDER + sx) * 3, d = (y * SIZE + x) * 3;
      out[d] = rgb[s]; out[d + 1] = rgb[s + 1]; out[d + 2] = rgb[s + 2];
    }
  return out;
}

// Each material shown on the blade, with the grip left as it came, which is
// how they are actually chosen.
const cells = MATERIALS.map((material) => {
  const look: FinishLook = {
    finishes: { [REGION_BLADE]: { ...material.finish } },
  };
  const recolored = applyFinishes(model, texture, mask, look);
  const result = render({
    model, geometry, sequence, frame: 40,
    lighting: { ambient: 70, shade: 150, direction: [0.3, 0.5, -0.8], gamma: DEFAULT_GAMMA },
    width: RENDER, height: RENDER,
    only: (c) => !isHandTexture(c),
    replace: new Map([[texture.name, { palette: recolored.palette, pixels: recolored.pixels }]]),
  });
  return crop(result.rgb, result.coverage);
});

const cols = 5, rows = Math.ceil(cells.length / cols);
const sheet = new Uint8Array(cols * SIZE * rows * SIZE * 3);
cells.forEach((cell, i) => {
  const ox = (i % cols) * SIZE, oy = Math.floor(i / cols) * SIZE;
  for (let y = 0; y < SIZE; y += 1)
    for (let x = 0; x < SIZE; x += 1) {
      const s = (y * SIZE + x) * 3, d = ((oy + y) * cols * SIZE + ox + x) * 3;
      sheet[d] = cell[s]; sheet[d + 1] = cell[s + 1]; sheet[d + 2] = cell[s + 2];
    }
});
const out = join(process.cwd(), "node_modules", ".tmp", `materials-${slug}.png`);
writeFileSync(out, encodePng(cols * SIZE, rows * SIZE, sheet));
console.log(MATERIALS.map((m, i) => `${i + 1}.${m.name}`).join("  "));
console.log(out);
