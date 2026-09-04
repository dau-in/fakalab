/**
 * Renders a knife with the blade and the handle coloured differently, and with
 * each pattern, so the pixel path can be judged by eye before it reaches the UI.
 *
 *   npx esbuild scripts/verify-regions-render.ts --bundle --platform=node \
 *     --format=esm --outfile=node_modules/.tmp/vr.mjs && node node_modules/.tmp/vr.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";

import { idleSequence } from "../src/mdl/animation";
import { buildGeometry } from "../src/mdl/geometry";
import { DEFAULT_GAMMA } from "../src/mdl/gamma";
import { hexToRgb, recolorPixelsOf, type Look } from "../src/mdl/recolor";
import { isHandTexture } from "../src/mdl/parse";
import { PATTERNS } from "../src/mdl/patterns";
import { REGION_BLADE, REGION_HANDLE, type RegionMask } from "../src/mdl/regions";
import { encodePng } from "./lib/png";
import { loadModel, render } from "./lib/software-render";

const SIZE = 460;

/** Reads a mask PNG written by build-regions, which uses no row filtering. */
function readMask(file: string): RegionMask {
  const buffer = readFileSync(file);
  let offset = 8;
  let width = 0;
  let height = 0;
  const chunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IHDR") {
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    }
    if (type === "IDAT") chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 3;
  const region = new Uint8Array(width * height);
  const along = new Uint8Array(width * height);
  const seen = new Set<number>();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = y * (stride + 1) + 1 + x * 3;
      const slot = y * width + x;
      region[slot] = raw[source];
      along[slot] = raw[source + 1];
      if (region[slot] !== 0) seen.add(region[slot]);
    }
  }

  return {
    width,
    height,
    region,
    along,
    present: [REGION_HANDLE, REGION_BLADE].filter((id) => seen.has(id)),
  };
}

const toStops = (colors: string[]) =>
  colors.map((hex, i) => ({ at: i / (colors.length - 1), color: hexToRgb(hex) }));

const slug = process.argv[2] ?? "bayonet-knife";
const model = loadModel(join(process.cwd(), "public", "models", `${slug}.mdl`));
const geometry = buildGeometry(model);
const sequence = idleSequence(model)!;
const mask = readMask(join(process.cwd(), "public", "regions", `${slug}.png`));
const texture = model.textures.find((candidate) => !isHandTexture(candidate))!;

const BLADE = toStops(["#0b1430", "#2a4f9e", "#5aa8e8", "#dff0ff"]);
const HANDLE = toStops(["#1a0d05", "#5c3110", "#a3641f", "#e8b872"]);

const cells: Uint8Array[] = [];
const labels: string[] = [];

for (const pattern of PATTERNS) {
  const look: Look = {
    ramps: { [REGION_HANDLE]: HANDLE, [REGION_BLADE]: BLADE },
    adjust: { brightness: 0, contrast: 0 },
    patternId: pattern.id,
    patternStrength: pattern.strength,
  };

  const started = Date.now();
  const recolored = recolorPixelsOf(model, texture, mask, look);
  const elapsed = Date.now() - started;

  const replace = new Map([
    [texture.name, { palette: recolored.palette, pixels: recolored.pixels }],
  ]);

  const result = render({
    model,
    geometry,
    sequence,
    frame: 40,
    lighting: { ambient: 60, shade: 150, direction: [0.3, 0.5, -0.8], gamma: DEFAULT_GAMMA },
    width: SIZE,
    height: SIZE,
    replace,
  });

  cells.push(result.rgb);
  labels.push(`${pattern.name} (${elapsed} ms)`);
}

const cols = 4;
const rows = Math.ceil(cells.length / cols);
const sheet = new Uint8Array(cols * SIZE * rows * SIZE * 3);
cells.forEach((cell, index) => {
  const ox = (index % cols) * SIZE;
  const oy = Math.floor(index / cols) * SIZE;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const s = (y * SIZE + x) * 3;
      const d = ((oy + y) * cols * SIZE + ox + x) * 3;
      sheet[d] = cell[s];
      sheet[d + 1] = cell[s + 1];
      sheet[d + 2] = cell[s + 2];
    }
  }
});

const out = join(process.cwd(), "node_modules", ".tmp", `look-${slug}.png`);
writeFileSync(out, encodePng(cols * SIZE, rows * SIZE, sheet));
console.log(`${slug}: regions ${mask.present.join(",")}`);
console.log(labels.join("  |  "));
console.log(out);
