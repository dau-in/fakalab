/**
 * A small software rasterizer for studio models, used by the offline checks.
 *
 * The browser renderer is the real one; this exists so bone math, animation
 * decoding, strip winding, UV mapping and the lighting pipeline can be looked
 * at directly, and so calibration can be tested against renders whose lighting
 * values are known in advance.
 */

import { readFileSync } from "node:fs";

import { setupBones } from "../../src/mdl/animation";
import { applyPose, buildGeometry, type ModelGeometry } from "../../src/mdl/geometry";
import { textureGammaTable, type GammaSettings } from "../../src/mdl/gamma";
import { applyLightGamma, studioIllum } from "../../src/mdl/lighting";
import { parseMdl, type MdlFile, type MdlSequence, type MdlTexture } from "../../src/mdl/parse";
import { decodeToRgba, readPalette, readPixels } from "../../src/mdl/texture";
import { isHandTexture } from "../../src/mdl/parse";

export interface SceneLighting {
  /** Engine units, 0-255. */
  ambient: number;
  shade: number;
  /** Direction in GoldSrc space. */
  direction: [number, number, number];
  gamma: GammaSettings;
}

export interface RenderOptions {
  model: MdlFile;
  geometry: ModelGeometry;
  sequence: MdlSequence;
  frame: number;
  lighting: SceneLighting;
  width: number;
  height: number;
  /** Pre-built replacements, keyed by texture name, for the pixel path. */
  replace?: Map<string, { palette: Uint8Array; pixels?: Uint8Array }>;
  /** RGB pixels drawn where the model is not, e.g. a real screenshot. */
  background?: Uint8Array;
  /** Draw only the meshes whose texture passes this test. */
  only?: (texture: MdlTexture) => boolean;
  /** When given, each drawn pixel records which part of the knife it is. */
  regions?: { width: number; height: number; region: Uint8Array };
}

export interface RenderResult {
  rgb: Uint8Array;
  /** 1 where the model covers a pixel. */
  coverage: Uint8Array;
  /**
   * Per covered pixel, the two halves of the lighting equation kept apart:
   * the texel's own brightness, and the geometric term
   * `min((1 - N.L) / lambert, 1)`.
   *
   * Splitting them means any ambient and shade pair can be evaluated later
   * without rasterizing again, since the final value is just
   * `texelPeak * lightGamma(ambient + shade * diffuse)`.
   */
  texelPeak: Uint8Array;
  diffuse: Float32Array;
  /** Which region each drawn pixel belongs to, when a mask was supplied. */
  region: Uint8Array;
}

export function loadModel(path: string): MdlFile {
  const file = readFileSync(path);
  return parseMdl(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
  );
}

export function render(options: RenderOptions): RenderResult {
  const { model, geometry, sequence, frame, lighting, width, height } = options;
  const gammaTable = textureGammaTable(lighting.gamma);

  const length = Math.hypot(...lighting.direction) || 1;
  const light = lighting.direction.map((v) => v / length) as [number, number, number];
  const ambient = lighting.ambient / 255;
  const shade = lighting.shade / 255;

  const textures = new Map<string, { rgba: Uint8ClampedArray; width: number; height: number }>();
  for (const mesh of geometry.meshes) {
    if (textures.has(mesh.texture.name)) continue;
    const swap = options.replace?.get(mesh.texture.name);
    const pixels = swap?.pixels ?? readPixels(model, mesh.texture);
    const source = readPalette(model, mesh.texture);
    const palette = swap?.palette ?? source;
    textures.set(mesh.texture.name, {
      rgba: decodeToRgba(pixels, palette, undefined, gammaTable),
      width: mesh.texture.width,
      height: mesh.texture.height,
    });
  }

  const bones = setupBones(model, sequence, frame);
  const posed = geometry.meshes.map((mesh) => applyPose(mesh, bones));

  const rgb = new Uint8Array(width * height * 3);
  if (options.background) rgb.set(options.background.subarray(0, rgb.length));
  const coverage = new Uint8Array(width * height);
  const texelPeak = new Uint8Array(width * height);
  const diffuseTerm = new Float32Array(width * height);
  const regionOf = new Uint8Array(width * height);
  const depth = new Float32Array(width * height).fill(Infinity);

  // The player's view: GoldSrc is Z-up with X forward and Y to the left, and
  // the eye sits at the origin. A 90 degree horizontal field of view makes the
  // projection scale exactly half the width.
  const scale = width / 2;
  const cx = width / 2;
  const cy = height / 2;
  const NEAR = 1;

  posed.forEach((mesh, index) => {
    const source = geometry.meshes[index];
    if (options.only && !options.only(source.texture)) return;
    const texture = textures.get(source.texture.name)!;

    for (let t = 0; t < source.triangleCount; t += 1) {
      const i0 = t * 3;

      const p = [0, 1, 2].map((k) => {
        const v = (i0 + k) * 3;
        const x = mesh.positions[v];
        const y = mesh.positions[v + 1];
        const z = mesh.positions[v + 2];
        return { sx: cx - (y / x) * scale, sy: cy - (z / x) * scale, depth: x, valid: x > NEAR };
      });
      if (!p[0].valid || !p[1].valid || !p[2].valid) continue;

      const area =
        (p[1].sx - p[0].sx) * (p[2].sy - p[0].sy) - (p[2].sx - p[0].sx) * (p[1].sy - p[0].sy);
      if (area === 0) continue;

      const minX = Math.max(0, Math.floor(Math.min(p[0].sx, p[1].sx, p[2].sx)));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(p[0].sx, p[1].sx, p[2].sx)));
      const minY = Math.max(0, Math.floor(Math.min(p[0].sy, p[1].sy, p[2].sy)));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(p[0].sy, p[1].sy, p[2].sy)));

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w0 = ((p[1].sx - px) * (p[2].sy - py) - (p[2].sx - px) * (p[1].sy - py)) / area;
          const w1 = ((p[2].sx - px) * (p[0].sy - py) - (p[0].sx - px) * (p[2].sy - py)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;

          const z = w0 * p[0].depth + w1 * p[1].depth + w2 * p[2].depth;
          const slot = y * width + x;
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

          // studioIllum with ambient 0 and shade 1 is the bare geometric term.
          const geometric = studioIllum(
            interp(mesh.normals, 3, 0),
            interp(mesh.normals, 3, 1),
            interp(mesh.normals, 3, 2),
            light,
            0,
            1,
          );
          const level = applyLightGamma(ambient + shade * geometric, lighting.gamma);

          const out = slot * 3;
          rgb[out] = Math.min(255, texture.rgba[texel] * level);
          rgb[out + 1] = Math.min(255, texture.rgba[texel + 1] * level);
          rgb[out + 2] = Math.min(255, texture.rgba[texel + 2] * level);
          coverage[slot] = 1;
          texelPeak[slot] = Math.max(
            texture.rgba[texel],
            texture.rgba[texel + 1],
            texture.rgba[texel + 2],
          );
          diffuseTerm[slot] = geometric;

          // The same UV that picked the texel picks the region, so a pixel
          // knows which part of the knife it is showing.
          if (options.regions) {
            const rx = Math.min(
              options.regions.width - 1,
              Math.max(0, Math.floor(u * options.regions.width)),
            );
            const ry = Math.min(
              options.regions.height - 1,
              Math.max(0, Math.floor(v * options.regions.height)),
            );
            regionOf[slot] = options.regions.region[ry * options.regions.width + rx];
          }
        }
      }
    }
  });

  return { rgb, coverage, texelPeak, diffuse: diffuseTerm, region: regionOf };
}

export { buildGeometry };
