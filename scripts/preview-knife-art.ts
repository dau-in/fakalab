/**
 * Rasterizes the drawn knife artwork so it can be looked at before shipping.
 *
 *   npx esbuild scripts/preview-knife-art.ts --bundle --platform=node \
 *     --format=esm --outfile=node_modules/.tmp/art.mjs && node node_modules/.tmp/art.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { KNIFE_ART, type Material } from "../src/ui/knife-art";
import { encodePng } from "./lib/png";
import { flattenPath, rasterize, type Shape } from "./lib/svg-raster";

const SIZE = 192;
const VIEW = 64;

/** The default theme's values, which is what the artwork is composed against. */
const PALETTE: Record<Material, [number, number, number]> = {
  face: [196, 181, 80], // --accent
  bevel: [149, 136, 49], // --secondary-accent
  grip: [41, 44, 33], // --border-dark
  grit: [140, 146, 132], // --border-light
  edge: [255, 255, 255], // --button-text
};
const GROUND: [number, number, number] = [62, 70, 55]; // --secondary-bg

const cells: Array<{ label: string; rgb: Uint8Array }> = [];

for (const [slug, shapes] of Object.entries(KNIFE_ART)) {
  const drawn: Shape[] = shapes.map((shape) => ({
    d: shape.d,
    color: PALETTE[shape.material],
    ...(shape.evenOdd ? { evenOdd: true } : {}),
  }));
  cells.push({ label: slug, rgb: rasterize(drawn, SIZE, VIEW, GROUND) });
}

// The project's own icon, for the style to be judged against.
const logo = readFileSync(join(process.cwd(), "src", "assets", "karambit.svg"), "utf8");
const logoShapes: Shape[] = [];
for (const match of logo.matchAll(/<path[^>]*d="([^"]+)"[^>]*fill="(#[0-9a-f]{6})"/gi)) {
  const hex = match[2];
  logoShapes.push({
    d: match[1],
    color: [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ],
    evenOdd: /fill-rule="evenodd"/.test(match[0]),
  });
}

// The logo draws inside a transformed group, so bake that transform in.
// translate(32,32) rotate(15) scale(-1,1) scale(0.75) translate(-20.9,-32.25)
const rad = (15 * Math.PI) / 180;
const cos = Math.cos(rad);
const sin = Math.sin(rad);
const transformed = logoShapes.map((shape) => {
  const contours = flattenPath(shape.d).map((contour) =>
    contour.map(({ x, y }) => {
      let px = (x - 20.9) * 0.75;
      let py = (y - 32.25) * 0.75;
      px = -px; // scale(-1, 1)
      const rx = px * cos - py * sin;
      const ry = px * sin + py * cos;
      return { x: rx + 32, y: ry + 32 };
    }),
  );
  return {
    d: contours
      .map((contour) => `M ${contour.map((p) => `${p.x},${p.y}`).join(" L ")} Z`)
      .join(" "),
    color: shape.color,
    ...(shape.evenOdd ? { evenOdd: true } : {}),
  } satisfies Shape;
});
cells.unshift({ label: "karambit (the project icon)", rgb: rasterize(transformed, SIZE, VIEW, GROUND) });

const W = SIZE * cells.length;
const sheet = new Uint8Array(W * SIZE * 3);
cells.forEach((cell, index) => {
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const s = (y * SIZE + x) * 3;
      const d = (y * W + index * SIZE + x) * 3;
      sheet[d] = cell.rgb[s];
      sheet[d + 1] = cell.rgb[s + 1];
      sheet[d + 2] = cell.rgb[s + 2];
    }
  }
});

const out = join(process.cwd(), "node_modules", ".tmp", "knife-art.png");
writeFileSync(out, encodePng(W, SIZE, sheet));
console.log(cells.map((cell) => cell.label).join("  |  "));
console.log(out);
