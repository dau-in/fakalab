/**
 * Fits ambientlight and shadelight from real in-game screenshots.
 *
 * The engine samples those two values from the map at the player's position,
 * so they are the one part of the lighting pipeline that cannot be ported from
 * source. Everything around them is exact, which makes them solvable.
 *
 * The method leans on the fact that studio lighting is a scalar multiply:
 * a lit pixel is `textureGamma[texel] * L`, so the *chromaticity* of a lit
 * surface is unchanged. Matching a screenshot pixel's chromaticity against the
 * hand texture identifies which texel it came from, and dividing recovers L.
 *
 * Chromaticity alone is not enough to find the hands: sand, stone and dark
 * noise all land in the same region, and an early attempt measured the walls
 * of de_dust2 instead of the player's arms. So each spot needs a pair of
 * screenshots taken without moving, one with `r_drawviewmodel 1` and one with
 * `r_drawviewmodel 0`. Differencing them isolates the viewmodel exactly, and
 * chromaticity then only has to separate skin from glove inside that mask.
 *
 * A forearm is a cylinder, so it sweeps nearly the whole range of normals in
 * every pose. That pins both ends of the curve at once:
 *
 *   min(L) = lightGamma(ambient)          normal facing the light
 *   max(L) = lightGamma(ambient + shade)  normal facing away
 *
 * Inverting the gamma curve on robust percentiles gives both numbers without
 * having to reproduce the pose.
 *
 *   npx esbuild scripts/calibrate-lighting.ts --bundle --platform=node \
 *     --format=esm --outfile=node_modules/.tmp/calibrate.mjs
 *   node node_modules/.tmp/calibrate.mjs <with.bmp> <without.bmp> [...]
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

import { textureGammaTable, type GammaSettings } from "../src/mdl/gamma";
import { applyLightGamma } from "../src/mdl/lighting";
import { parseMdl } from "../src/mdl/parse";
import { readPalette, readPixels } from "../src/mdl/texture";

/** The player's own video settings, read from their console. */
const PLAYER_GAMMA: GammaSettings = {
  gamma: 3,
  brightness: 2,
  texGamma: 2.0,
  lightGamma: 2.5,
};

/** Screen area the viewmodel occupies, avoiding the HUD along the bottom. */
const REGION = { x0: 0.05, x1: 0.95, y0: 0.35, y1: 0.93 };

/** How different a pixel must be between the pair to count as viewmodel. */
const DIFFERENCE_THRESHOLD = 10;

/** Chromaticity distance below which a pixel is accepted as hand skin. */
const CHROMA_TOLERANCE = 0.012;

/** Very dark and blown-out pixels carry no usable chromaticity. */
const MIN_LEVEL = 14;
const MAX_LEVEL = 250;

interface Bitmap {
  width: number;
  height: number;
  rgb: Uint8Array;
}

function readBmp(file: string): Bitmap {
  const b = readFileSync(file);
  const dataOffset = b.readUInt32LE(10);
  const width = b.readInt32LE(18);
  const signedHeight = b.readInt32LE(22);
  const bpp = b.readUInt16LE(28);
  const height = Math.abs(signedHeight);
  const bottomUp = signedHeight > 0;
  const stride = Math.floor((bpp * width + 31) / 32) * 4;

  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const sourceY = bottomUp ? height - 1 - y : y;
    for (let x = 0; x < width; x += 1) {
      const s = dataOffset + sourceY * stride + x * (bpp / 8);
      const d = (y * width + x) * 3;
      rgb[d] = b[s + 2];
      rgb[d + 1] = b[s + 1];
      rgb[d + 2] = b[s];
    }
  }
  return { width, height, rgb };
}

/** Unique gamma-corrected colors of the hand textures, with chromaticity. */
function handPalette(modelPath: string) {
  const file = readFileSync(modelPath);
  const model = parseMdl(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
  );
  const table = textureGammaTable(PLAYER_GAMMA);

  const entries: Array<{ r: number; g: number; b: number; cr: number; cg: number }> = [];
  for (const texture of model.textures) {
    if (!/view_(skin|glove|finger)/i.test(texture.name)) continue;

    const used = new Set(readPixels(model, texture));
    const palette = readPalette(model, texture);
    for (const index of used) {
      const r = table[palette[index * 3]];
      const g = table[palette[index * 3 + 1]];
      const b = table[palette[index * 3 + 2]];
      const sum = r + g + b;
      if (sum < 60) continue; // too dark to have a stable hue
      entries.push({ r, g, b, cr: r / sum, cg: g / sum });
    }
  }
  return entries;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

/** Numeric inverse of the light gamma curve; it is monotonic in x. */
function invertLightGamma(target: number): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    if (applyLightGamma(mid, PLAYER_GAMMA) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** FAKALAB_DEBUG=1 writes a copy of each shot with accepted pixels tinted. */
const debug = process.env.FAKALAB_DEBUG === "1";

const crcTable: number[] = [];
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** Writes the screenshot with every sampled pixel pushed toward magenta. */
function writeMask(name: string, image: Bitmap, mask: Uint8Array): void {
  const { width, height } = image;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const s = (y * width + x) * 3;
      const d = row + 1 + x * 3;
      if (mask[y * width + x]) {
        raw[d] = 255;
        raw[d + 1] = 0;
        raw[d + 2] = 255;
      } else {
        raw[d] = image.rgb[s] >> 1;
        raw[d + 1] = image.rgb[s + 1] >> 1;
        raw[d + 2] = image.rgb[s + 2] >> 1;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(
    join(process.cwd(), "node_modules", ".tmp", `mask-${name.replace(/\.bmp$/i, "")}.png`),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", deflateSync(raw)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const directory = process.argv[2] ?? ".";
const models = join(process.cwd(), "public", "models");
const hands = handPalette(join(models, "bayonet-knife.mdl"));

console.log(
  `player cvars: gamma ${PLAYER_GAMMA.gamma}, brightness ${PLAYER_GAMMA.brightness}, ` +
    `texgamma ${PLAYER_GAMMA.texGamma}, lightgamma ${PLAYER_GAMMA.lightGamma}`,
);
console.log(`hand palette: ${hands.length} usable colors\n`);
console.log(
  "screenshot".padEnd(22),
  "pixels".padStart(8),
  "L range".padStart(15),
  "ambient".padStart(9),
  "shade".padStart(7),
);

const shots = readdirSync(directory)
  .filter((name) => name.toLowerCase().endsWith(".bmp"))
  .sort();

for (const name of shots) {
  const image = readBmp(join(directory, name));
  const x0 = Math.floor(image.width * REGION.x0);
  const x1 = Math.floor(image.width * REGION.x1);
  const y0 = Math.floor(image.height * REGION.y0);
  const y1 = Math.floor(image.height * REGION.y1);

  const samples: number[] = [];
  const mask = debug ? new Uint8Array(image.width * image.height) : null;

  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const o = (y * image.width + x) * 3;
      const r = image.rgb[o];
      const g = image.rgb[o + 1];
      const b = image.rgb[o + 2];
      const sum = r + g + b;

      const peak = Math.max(r, g, b);
      if (peak < MIN_LEVEL || peak > MAX_LEVEL || sum === 0) continue;

      const cr = r / sum;
      const cg = g / sum;

      // Nearest hand color in chromaticity, which lighting cannot change.
      let best = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < hands.length; i += 1) {
        const dr = cr - hands[i].cr;
        const dg = cg - hands[i].cg;
        const distance = dr * dr + dg * dg;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      if (Math.sqrt(bestDistance) > CHROMA_TOLERANCE) continue;

      // The texel must be at least as bright as what we observed, since
      // lighting only ever scales down.
      const source = hands[best];
      const sourcePeak = Math.max(source.r, source.g, source.b);
      if (sourcePeak <= peak) continue;

      samples.push(peak / sourcePeak);
      if (mask) mask[y * image.width + x] = 1;
    }
  }

  if (mask) writeMask(name, image, mask);

  if (samples.length < 500) {
    console.log(name.padEnd(22), String(samples.length).padStart(8), "  too few samples");
    continue;
  }

  samples.sort((a, b) => a - b);
  const low = percentile(samples, 0.05);
  const high = percentile(samples, 0.95);

  const ambient = invertLightGamma(low) * 255;
  const total = invertLightGamma(high) * 255;
  const shade = Math.max(0, total - ambient);

  console.log(
    name.padEnd(22),
    String(samples.length).padStart(8),
    `${low.toFixed(3)}-${high.toFixed(3)}`.padStart(15),
    ambient.toFixed(1).padStart(9),
    shade.toFixed(1).padStart(7),
  );
}
