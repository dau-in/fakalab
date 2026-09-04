/**
 * Software-renders a knife at a given sequence and frame, as a check on the
 * parts that fail silently: bone transforms, animation decoding, triangle-strip
 * winding, UV mapping and the GoldSrc lighting formula. A mistake in any of
 * them is obvious on sight and invisible in a type check.
 *
 *   npx esbuild scripts/render-pose.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.tmp/render.mjs
 *   node node_modules/.tmp/render.mjs karambit-knife idle 0 20 40
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { idleSequence, setupBones } from "../src/mdl/animation";
import { applyPose, boundsOf, buildGeometry, type PosedMesh } from "../src/mdl/geometry";
import { parseMdl } from "../src/mdl/parse";
import { decodeToRgba, readPalette, readPixels } from "../src/mdl/texture";
import { ORIGINAL_FINISH } from "../src/mdl/finish";
import { applyTint, hexToHsv } from "../src/mdl/finish";
import { isHandTexture } from "../src/mdl/parse";
import { DEFAULT_GAMMA, textureGammaTable } from "../src/mdl/gamma";
import { applyLightGamma, studioIllum } from "../src/mdl/lighting";

const PANEL = 420;

const AMBIENT = 40 / 255;
const SHADE = 170 / 255;
const RAW_LIGHT: [number, number, number] = [0.3, 0.5, -0.8];
const LENGTH = Math.hypot(...RAW_LIGHT);
const LIGHT = RAW_LIGHT.map((v) => v / LENGTH) as [number, number, number];

/** Set FAKALAB_NO_GAMMA=1 to see the raw output the engine never shows. */
const useGamma = process.env.FAKALAB_NO_GAMMA !== "1";
const gammaTable = textureGammaTable(DEFAULT_GAMMA);

function studioLighting(nx: number, ny: number, nz: number): number {
  const illum = studioIllum(nx, ny, nz, LIGHT, AMBIENT, SHADE);
  return useGamma ? applyLightGamma(illum, DEFAULT_GAMMA) : Math.min(1, Math.max(0, illum));
}

const [, , slug = "karambit-knife", label = "idle", presetId = "none", ...frameArgs] = process.argv;
const tintColor = presetId === "none" ? null : presetId.startsWith("#") ? presetId : "#2b3a5c";
const frames = frameArgs.length > 0 ? frameArgs.map(Number) : [0];

const file = readFileSync(join(process.cwd(), "public", "models", `${slug}.mdl`));
const model = parseMdl(
  file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
);
const geometry = buildGeometry(model);

const sequence =
  model.sequences.find((candidate) => candidate.label.toLowerCase() === label.toLowerCase()) ??
  idleSequence(model);
if (!sequence) throw new Error(`${slug} has no sequences`);

const decoded = new Map<string, { rgba: Uint8ClampedArray; width: number; height: number }>();
for (const mesh of geometry.meshes) {
  if (decoded.has(mesh.texture.name)) continue;
  const pixels = readPixels(model, mesh.texture);
  const source = readPalette(model, mesh.texture);
  let palette = source;
  if (tintColor && !isHandTexture(mesh.texture)) {
    const target = hexToHsv(tintColor, undefined, 0);
    palette = new Uint8Array(768);
    for (let entry = 0; entry < 256; entry += 1) {
      const o = entry * 3;
      const tinted = applyTint([source[o], source[o + 1], source[o + 2]], target, 0.85, 0);
      palette[o] = tinted[0];
      palette[o + 1] = tinted[1];
      palette[o + 2] = tinted[2];
    }
  }
  decoded.set(mesh.texture.name, {
    rgba: decodeToRgba(pixels, palette, undefined, useGamma ? gammaTable : undefined),
    width: mesh.texture.width,
    height: mesh.texture.height,
  });
}

const posedFrames: PosedMesh[][] = frames.map((frame) => {
  const bones = setupBones(model, sequence, frame);
  return geometry.meshes.map((mesh) => applyPose(mesh, bones));
});

// One shared framing so motion between frames reads as motion, not rescaling.
const all = posedFrames.flat();
const { min, max } = boundsOf(all);
const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
const center = min.map((low, i) => (low + max[i]) / 2);
const scale = (PANEL * 0.9) / Math.max(max[1] - min[1], max[2] - min[2]);

const width = PANEL * frames.length;
const rgb = Buffer.alloc(width * PANEL * 3, 26);

posedFrames.forEach((posed, panel) => {
  const depth = new Float32Array(PANEL * PANEL).fill(Infinity);
  const originX = panel * PANEL;

  // The player's view. GoldSrc is Z-up with X forward and Y to the left, so
  // the camera looks down +X: screen right is -Y, screen up is +Z, depth is X.
  const project = (x: number, y: number, z: number) => ({
    sx: PANEL / 2 - (y - center[1]) * scale,
    sy: PANEL / 2 - (z - center[2]) * scale,
    sz: x,
  });

  posed.forEach((mesh, index) => {
    const source = geometry.meshes[index];
    const texture = decoded.get(source.texture.name)!;

    for (let t = 0; t < source.triangleCount; t += 1) {
      const i0 = t * 3;
      const p = [0, 1, 2].map((k) => {
        const v = (i0 + k) * 3;
        return project(mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]);
      });

      const area =
        (p[1].sx - p[0].sx) * (p[2].sy - p[0].sy) - (p[2].sx - p[0].sx) * (p[1].sy - p[0].sy);
      if (area === 0) continue;

      const minX = Math.max(0, Math.floor(Math.min(p[0].sx, p[1].sx, p[2].sx)));
      const maxX = Math.min(PANEL - 1, Math.ceil(Math.max(p[0].sx, p[1].sx, p[2].sx)));
      const minY = Math.max(0, Math.floor(Math.min(p[0].sy, p[1].sy, p[2].sy)));
      const maxY = Math.min(PANEL - 1, Math.ceil(Math.max(p[0].sy, p[1].sy, p[2].sy)));

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((p[1].sx - px) * (p[2].sy - py) - (p[2].sx - px) * (p[1].sy - py)) / area;
          const w1 = ((p[2].sx - px) * (p[0].sy - py) - (p[0].sx - px) * (p[2].sy - py)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;

          const z = w0 * p[0].sz + w1 * p[1].sz + w2 * p[2].sz;
          const slot = y * PANEL + x;
          if (z >= depth[slot]) continue;
          depth[slot] = z;

          const interp = (array: Float32Array, stride: number, axis: number) =>
            w0 * array[i0 * stride + axis] +
            w1 * array[(i0 + 1) * stride + axis] +
            w2 * array[(i0 + 2) * stride + axis];

          const u = interp(source.uvs, 2, 0);
          const v = interp(source.uvs, 2, 1);
          const tx = Math.min(texture.width - 1, Math.max(0, Math.floor(u * texture.width)));
          const ty = Math.min(texture.height - 1, Math.max(0, Math.floor(v * texture.height)));
          const texel = (ty * texture.width + tx) * 4;

          const light = studioLighting(
            interp(mesh.normals, 3, 0),
            interp(mesh.normals, 3, 1),
            interp(mesh.normals, 3, 2),
          );

          const out = (y * width + originX + x) * 3;
          rgb[out] = Math.min(255, texture.rgba[texel] * light);
          rgb[out + 1] = Math.min(255, texture.rgba[texel + 1] * light);
          rgb[out + 2] = Math.min(255, texture.rgba[texel + 2] * light);
        }
      }
    }
  });
});

// --- minimal PNG writer -------------------------------------------------
const table: number[] = [];
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}
const crc = (buffer: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), data])), 0);
  return Buffer.concat([head, data, tail]);
};

const raw = Buffer.alloc((width * 3 + 1) * PANEL);
for (let y = 0; y < PANEL; y += 1) {
  rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(PANEL, 4);
ihdr[8] = 8;
ihdr[9] = 2;

const suffix = useGamma ? "" : "-nogamma";
const out = join(process.cwd(), "node_modules", ".tmp", `pose-${slug}${suffix}.png`);
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);

const triangles = geometry.meshes.reduce((sum, mesh) => sum + mesh.triangleCount, 0);
console.log(
  `${slug} · ${sequence.label} · ${sequence.numFrames} frames @ ${sequence.fps} fps · ` +
    `tint ${tintColor ?? "none"} · gamma ${useGamma ? "engine" : "off"}`,
);
console.log(`${geometry.meshes.length} meshes, ${triangles} triangles`);
console.log(`frames rendered: ${frames.join(", ")}`);
console.log(out);
