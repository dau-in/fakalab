/**
 * Builds the site icon from the karambit drawing the picker already uses.
 *
 * The icon and the thumbnails should be recognisably the same knife, and the
 * one drawn by hand for the project was close but not the same drawing. This
 * takes the generated karambit instead and varies it for the size it is seen
 * at: a browser tab is sixteen pixels across, so the two blade tones collapse
 * into one and the two grip tones into one, leaving a gold blade, a dark grip
 * and the bright edge. It is cropped tighter than a thumbnail and set on its
 * own rounded ground, which is what keeps it legible against a light tab strip
 * and a dark one alike.
 *
 * The output is an SVG of merged rectangles rather than an image, so it stays
 * sharp at every size, and it carries the light theme's colours in a media
 * query of its own since a favicon cannot read the page's.
 *
 *   npm run favicon
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { encodePng } from "./lib/png";

/** Material indices as build-knife-art writes them. */
const MATERIAL_STEP = 51;
const NONE = 0;

/** Blade tones, then grip tones, then the edge; see the note above. */
const SIMPLIFY = [NONE, 1, 1, 2, 2, 3];

// The grip is the theme's mid tone rather than its darkest: the near-black a
// thumbnail uses would sit on a near-black ground here and leave the icon a
// floating hook with no handle under it.
const DARK = ["", "#d8a63f", "#7c7565", "#f3e6cd"];
const LIGHT = ["", "#b07d1c", "#6b6353", "#ffffff"];
const GROUND_DARK = "#16150f";
const GROUND_LIGHT = "#efe7d8";

/** Margin around the knife, in icon units. */
const PADDING = 2;
const SIZE = 64;

function readArt(file: string): { width: number; height: number; index: Uint8Array } {
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
  const index = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x * 3];
      index[y * width + x] = SIMPLIFY[Math.round(value / MATERIAL_STEP)] ?? NONE;
    }
  }
  return { width, height, index };
}

/**
 * Runs of one colour, merged down the image where a run repeats directly
 * below, so the icon is a few dozen rectangles rather than a few thousand.
 */
function rectangles(
  index: Uint8Array,
  width: number,
  height: number,
): Array<{ x: number; y: number; w: number; h: number; material: number }> {
  const done = new Uint8Array(index.length);
  const out: Array<{ x: number; y: number; w: number; h: number; material: number }> = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const slot = y * width + x;
      const material = index[slot];
      if (material === NONE || done[slot]) continue;

      let w = 1;
      while (x + w < width && index[slot + w] === material && !done[slot + w]) w += 1;

      let h = 1;
      while (y + h < height) {
        let same = true;
        for (let i = 0; i < w; i += 1) {
          const below = (y + h) * width + x + i;
          if (index[below] !== material || done[below]) {
            same = false;
            break;
          }
        }
        if (!same) break;
        h += 1;
      }

      for (let dy = 0; dy < h; dy += 1) {
        for (let dx = 0; dx < w; dx += 1) done[(y + dy) * width + x + dx] = 1;
      }
      out.push({ x, y, w, h, material });
    }
  }
  return out;
}

const art = readArt(join(process.cwd(), "public", "art", "karambit-knife.png"));

// Crop to what is actually drawn, then blow it back up to the icon's own size,
// which is the difference between a knife and a knife with a wide empty border.
let minX = art.width;
let minY = art.height;
let maxX = -1;
let maxY = -1;
for (let y = 0; y < art.height; y += 1) {
  for (let x = 0; x < art.width; x += 1) {
    if (art.index[y * art.width + x] === NONE) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}

const span = Math.max(maxX - minX + 1, maxY - minY + 1);
const scale = (SIZE - PADDING * 2) / span;
const offsetX = PADDING + ((SIZE - PADDING * 2) - (maxX - minX + 1) * scale) / 2 - minX * scale;
const offsetY = PADDING + ((SIZE - PADDING * 2) - (maxY - minY + 1) * scale) / 2 - minY * scale;

const round = (value: number) => Math.round(value * 100) / 100;
const boxes = rectangles(art.index, art.width, art.height);
const shapes = boxes
  .map(
    (box) =>
      `<rect class="m${box.material}" x="${round(box.x * scale + offsetX)}" y="${round(
        box.y * scale + offsetY,
      )}" width="${round(box.w * scale)}" height="${round(box.h * scale)}"/>`,
  )
  .join("");

const rules = (colors: string[], ground: string) =>
  `.g{fill:${ground}}` + colors.map((color, i) => (color ? `.m${i}{fill:${color}}` : "")).join("");

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">` +
  `<style>${rules(DARK, GROUND_DARK)}` +
  `@media(prefers-color-scheme:light){${rules(LIGHT, GROUND_LIGHT)}}</style>` +
  `<rect class="g" width="${SIZE}" height="${SIZE}" rx="12"/>` +
  `${shapes}</svg>`;

writeFileSync(join(process.cwd(), "public", "icon.svg"), `${svg}\n`);

// A raster copy for anything that will not take an SVG icon, drawn at three
// times the size so every pixel of the source lands on a whole number of them.
const RASTER = SIZE * 3;
const pixels = new Uint8Array(RASTER * RASTER * 3);
const hex = (color: string): [number, number, number] => {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};
const ground = hex(GROUND_DARK);
for (let i = 0; i < RASTER * RASTER; i += 1) {
  pixels[i * 3] = ground[0];
  pixels[i * 3 + 1] = ground[1];
  pixels[i * 3 + 2] = ground[2];
}
for (const box of boxes) {
  const color = hex(DARK[box.material]);
  const x0 = Math.round((box.x * scale + offsetX) * 3);
  const y0 = Math.round((box.y * scale + offsetY) * 3);
  const x1 = Math.round((box.x + box.w) * scale * 3 + offsetX * 3);
  const y1 = Math.round((box.y + box.h) * scale * 3 + offsetY * 3);
  for (let y = Math.max(0, y0); y < Math.min(RASTER, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(RASTER, x1); x += 1) {
      const slot = (y * RASTER + x) * 3;
      pixels[slot] = color[0];
      pixels[slot + 1] = color[1];
      pixels[slot + 2] = color[2];
    }
  }
}
const png = encodePng(RASTER, RASTER, pixels);
writeFileSync(join(process.cwd(), "public", "icon.png"), png);

console.log(`icon.svg  ${svg.length} B, ${boxes.length} rectangles`);
console.log(`icon.png  ${png.length} B, ${RASTER}x${RASTER}`);
