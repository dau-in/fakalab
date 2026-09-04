/**
 * Turns Counter-Strike's own skyboxes into backdrops for the viewport.
 *
 * A skybox is six 256x256 TGA faces. Only the front one is used: laying three
 * faces side by side leaves a hard seam at each join, because they are meant to
 * be seen from inside a cube and not flattened into a strip. One face scaled up
 * and softened has no seam to hide, and a backdrop sitting behind a knife is
 * out of focus anyway.
 *
 * The bottom fades into the ground colour so the frame has somewhere to stand.
 * That fade averages each row across its full width first, otherwise whatever
 * happened to be in the last row of sky smears downward as vertical streaks.
 *
 * These are Valve's textures, not community work, and the Steam Subscriber
 * Agreement covers exactly this: fan art may incorporate content from Valve
 * games and be distributed freely, on a non-commercial basis. Taking a
 * screenshot off a forum instead would drag in whoever took it, and the same
 * agreement says their rights would be ours to obtain. Valve's own files have
 * no such third party.
 *
 *   npm run backdrops -- "<path to cstrike/gfx/env>"
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { encodePng } from "./lib/png";

/** Which skyboxes to ship, and what to call them. */
const BACKDROPS: Array<{ id: string; name: string; sky: string }> = [
  { id: "desert", name: "Desert", sky: "Des" },
  { id: "city", name: "City", sky: "city1" },
  { id: "dawn", name: "Dawn", sky: "morningdew" },
  { id: "storm", name: "Storm", sky: "tornsky" },
  { id: "snow", name: "Snow", sky: "snow" },
  { id: "night", name: "Night", sky: "backalley" },
];

const FACE_SIZE = 256;
const SCALE = 3;
const WIDTH = FACE_SIZE * SCALE;
const SKY_HEIGHT = FACE_SIZE * 2;
const GROUND_HEIGHT = 160;
const HEIGHT = SKY_HEIGHT + GROUND_HEIGHT;

interface Face {
  width: number;
  height: number;
  rgb: Uint8Array;
}

/** Reads an uncompressed true-colour TGA, which is what these all are. */
function readTga(buffer: Buffer): Face {
  const idLength = buffer[0];
  const imageType = buffer[2];
  if (imageType !== 2) throw new Error(`unsupported TGA image type ${imageType}`);

  const width = buffer.readUInt16LE(12);
  const height = buffer.readUInt16LE(14);
  const depth = buffer[16];
  const descriptor = buffer[17];
  const bytes = depth / 8;
  const start = 18 + idLength;

  // Bit 5 of the descriptor set means the first row stored is the top one.
  const topDown = (descriptor & 0x20) !== 0;
  const rgb = new Uint8Array(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const s = start + (sourceY * width + x) * bytes;
      const d = (y * width + x) * 3;
      rgb[d] = buffer[s + 2];
      rgb[d + 1] = buffer[s + 1];
      rgb[d + 2] = buffer[s];
    }
  }
  return { width, height, rgb };
}

/** A separable box blur, run twice, which is close enough to a gaussian here. */
function blur(rgb: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  let source = rgb;
  let target = new Uint8Array(rgb.length);

  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const sx = Math.min(width - 1, Math.max(0, x + k));
          const s = (y * width + sx) * 3;
          r += source[s];
          g += source[s + 1];
          b += source[s + 2];
          n += 1;
        }
        const d = (y * width + x) * 3;
        target[d] = r / n;
        target[d + 1] = g / n;
        target[d + 2] = b / n;
      }
    }
    // Swap axes by transposing the roles: blur vertically on the second pass.
    const swapped = new Uint8Array(rgb.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const sy = Math.min(height - 1, Math.max(0, y + k));
          const s = (sy * width + x) * 3;
          r += target[s];
          g += target[s + 1];
          b += target[s + 2];
          n += 1;
        }
        const d = (y * width + x) * 3;
        swapped[d] = r / n;
        swapped[d + 1] = g / n;
        swapped[d + 2] = b / n;
      }
    }
    source = swapped;
    target = new Uint8Array(rgb.length);
  }
  return source;
}

const envDir = process.argv[2];
if (!envDir) throw new Error('usage: build-backdrops "<path to cstrike/gfx/env>"');

const target = join(process.cwd(), "public", "backdrops");
await mkdir(target, { recursive: true });

/** Skybox faces are named with a suffix, in whatever case the file happens to use. */
async function loadFace(sky: string, suffix: string): Promise<Face> {
  for (const name of [
    `${sky}${suffix}.tga`,
    `${sky}${suffix.toUpperCase()}.tga`,
    `${sky}${suffix[0].toUpperCase()}${suffix[1]}.tga`,
  ]) {
    try {
      return readTga(await readFile(join(envDir, name)));
    } catch {
      // try the next spelling
    }
  }
  throw new Error(`no face ${suffix} for skybox ${sky}`);
}

console.log("backdrop".padEnd(12) + "skybox".padEnd(14) + "size".padStart(9));

for (const entry of BACKDROPS) {
  const [front, down] = await Promise.all([
    loadFace(entry.sky, "ft"),
    loadFace(entry.sky, "dn"),
  ]);

  // One face, scaled with bilinear sampling so the upscale does not blockify.
  const strip = new Uint8Array(WIDTH * SKY_HEIGHT * 3);
  for (let y = 0; y < SKY_HEIGHT; y += 1) {
    const fy = (y / SKY_HEIGHT) * (front.height - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(front.height - 1, y0 + 1);
    const ty = fy - y0;

    for (let x = 0; x < WIDTH; x += 1) {
      const fx = (x / WIDTH) * (front.width - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(front.width - 1, x0 + 1);
      const tx = fx - x0;

      const d = (y * WIDTH + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const a = front.rgb[(y0 * front.width + x0) * 3 + c];
        const b = front.rgb[(y0 * front.width + x1) * 3 + c];
        const e = front.rgb[(y1 * front.width + x0) * 3 + c];
        const f = front.rgb[(y1 * front.width + x1) * 3 + c];
        strip[d + c] = (a + (b - a) * tx) * (1 - ty) + (e + (f - e) * tx) * ty;
      }
    }
  }

  // The ground: the down face's average, so the fade lands on a colour that
  // belongs to the same sky rather than an invented grey.
  let gr = 0;
  let gg = 0;
  let gb = 0;
  const pixels = down.width * down.height;
  for (let i = 0; i < pixels; i += 1) {
    gr += down.rgb[i * 3];
    gg += down.rgb[i * 3 + 1];
    gb += down.rgb[i * 3 + 2];
  }
  gr /= pixels;
  gg /= pixels;
  gb /= pixels;

  // Average the last band of sky across its whole width, so the fade starts
  // from a single colour instead of dragging the horizon down in streaks.
  const band = 24;
  const edge = [0, 0, 0];
  for (let y = SKY_HEIGHT - band; y < SKY_HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const s = (y * WIDTH + x) * 3;
      for (let c = 0; c < 3; c += 1) edge[c] += strip[s + c];
    }
  }
  for (let c = 0; c < 3; c += 1) edge[c] /= band * WIDTH;

  const ground = [gr * 0.5, gg * 0.5, gb * 0.5];
  const full = new Uint8Array(WIDTH * HEIGHT * 3);
  full.set(strip);
  for (let y = 0; y < GROUND_HEIGHT; y += 1) {
    // Ease in, so the horizon line is a transition rather than a hard edge.
    const t = y / (GROUND_HEIGHT - 1);
    const eased = t * t * (3 - 2 * t);
    for (let x = 0; x < WIDTH; x += 1) {
      const d = ((SKY_HEIGHT + y) * WIDTH + x) * 3;
      const above = ((SKY_HEIGHT - 1) * WIDTH + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        // Blend the real sky pixel toward the flat edge colour first, then
        // toward the ground, so nothing carries a vertical streak all the way.
        const start = strip[above + c] + (edge[c] - strip[above + c]) * Math.min(1, t * 4);
        full[d + c] = start + (ground[c] - start) * eased;
      }
    }
  }

  // Softened and dimmed at build time, so it reads as a backdrop rather than
  // competing with the knife, and the app does not need a filter over it.
  const softened = blur(full, WIDTH, HEIGHT, 5);
  for (let i = 0; i < softened.length; i += 1) softened[i] = softened[i] * 0.62;

  const png = encodePng(WIDTH, HEIGHT, softened);
  await writeFile(join(target, `${entry.id}.png`), png);

  console.log(
    entry.id.padEnd(12) + entry.sky.padEnd(14) + `${(png.length / 1024).toFixed(0)} KB`.padStart(9),
  );
}

console.log(`\n${BACKDROPS.length} backdrops in public/backdrops`);
