/**
 * Reads a region mask PNG in Node. The browser has createImageBitmap for this;
 * offline checks need their own reader, and the masks are written with no row
 * filtering, so inflating is enough.
 */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { REGION_BLADE, REGION_HANDLE, type RegionMask } from "../../src/mdl/regions";

export function readMaskFile(file: string): RegionMask {
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
