/**
 * GoldSrc textures are 8-bit indexed bitmaps: width * height index bytes,
 * immediately followed by a 256-entry RGB palette (768 bytes).
 */

import { PALETTE_BYTES, type MdlFile, type MdlTexture } from "./parse";

export const PALETTE_ENTRIES = 256;

export function paletteOffset(texture: MdlTexture): number {
  return texture.index + texture.width * texture.height;
}

/** The index bytes, one per pixel, read straight out of the file. */
export function readPixels(model: MdlFile, texture: MdlTexture): Uint8Array {
  return new Uint8Array(model.buffer, texture.index, texture.width * texture.height);
}

/** The 768-byte palette that follows the pixels. */
export function readPalette(model: MdlFile, texture: MdlTexture): Uint8Array {
  return new Uint8Array(model.buffer, paletteOffset(texture), PALETTE_BYTES);
}

/**
 * Expands indexed pixels into RGBA suitable for an ImageData or a WebGL
 * texture. Passing a replacement palette renders the recolored result without
 * touching the source file.
 *
 * `gammaTable` reproduces the correction the engine applies when it uploads a
 * texture. It is for display only: the exported model keeps the raw palette,
 * since the engine applies the same curve itself.
 */
export function decodeToRgba(
  pixels: Uint8Array,
  palette: Uint8Array,
  out: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(pixels.length * 4),
  gammaTable?: Uint8Array,
): Uint8ClampedArray<ArrayBuffer> {
  for (let i = 0; i < pixels.length; i += 1) {
    const entry = pixels[i] * 3;
    const o = i * 4;
    if (gammaTable) {
      out[o] = gammaTable[palette[entry]];
      out[o + 1] = gammaTable[palette[entry + 1]];
      out[o + 2] = gammaTable[palette[entry + 2]];
    } else {
      out[o] = palette[entry];
      out[o + 1] = palette[entry + 1];
      out[o + 2] = palette[entry + 2];
    }
    out[o + 3] = 255;
  }
  return out;
}

/** How many pixels use each palette entry. Drives brightness normalization. */
export function paletteHistogram(pixels: Uint8Array): Uint32Array {
  const counts = new Uint32Array(PALETTE_ENTRIES);
  for (let i = 0; i < pixels.length; i += 1) counts[pixels[i]] += 1;
  return counts;
}
