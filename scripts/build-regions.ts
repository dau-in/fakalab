/**
 * Splits each knife texture into blade and handle, with nobody painting a mask.
 *
 * Two facts make this work, and both come out of the file itself:
 *
 *   1. Rasterizing the triangles' UVs marks which texels the knife shows, and
 *      those marks fall into disconnected islands. Checked by eye on the
 *      karambit: the two faces of the blade, the two faces of the handle, the
 *      ring and the guard each get their own island, and none of them straddle
 *      two parts. So an island is safe to colour as a unit, which means a
 *      region boundary can never cut through the middle of a surface.
 *
 *   2. Which island is which part is a question about 3D, not about the
 *      texture. The blade is the end furthest from the hand holding it, so
 *      measuring each island's distance from the nearest hand and splitting the
 *      library of islands in two names them. Nearest, not the right hand: the
 *      shadow daggers put one in each hand, and measuring everything from the
 *      right made the whole left dagger read as blade.
 *
 * The pose this is measured in matters. The bind pose is the modeling pose, and
 * on a folding knife the blade is closed there, sitting right against the grip
 * and reading as handle: the flip knife came out 5% blade, with the blade
 * tinted as handle. So the measurement is taken at whichever frame of the idle
 * animation holds the knife furthest from the hand, which is the frame where a
 * folding knife is open and a fixed one is unaffected.
 *
 * Distance alone still loses on a butterfly knife, where the two handle halves
 * swing further from the hand than the blade does and came out labelled blade.
 * Those models happen to be the ones that name their parts: the fold mechanism
 * needs a bone each for the blade, the front and rear handles and the lock. So
 * where a bone says which part a triangle belongs to, that wins, and distance
 * only decides the models that stay silent.
 *
 * Neither signal is right everywhere, and this is curation, not a feature: the
 * masks are generated once per model and checked by eye. OVERRIDES records the
 * handful that need telling, with the reason.
 *
 * The mask carries a second thing in its green channel: how far along the knife
 * each texel sits, from the grip at 0 to the tip at 255. A texture atlas has no
 * idea which way is along the blade, so without this a gradient can only run
 * across the UV layout, which lands nowhere in particular on the model. With
 * it, a fade can run guard to tip the way the real skin does.
 *
 * The result ships as a small PNG per knife rather than being recomputed in the
 * browser, since it never changes for a given model.
 *
 *   npm run regions
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { transformPoint, type Matrix3x4 } from "../src/mdl/bones";
import { idleSequence, setupBones } from "../src/mdl/animation";
import { KNIVES } from "../src/data/knives";
import { buildGeometry, type MeshGeometry } from "../src/mdl/geometry";
import { isHandTexture, type MdlFile, type MdlTexture } from "../src/mdl/parse";
import { decodeToRgba, readPalette, readPixels } from "../src/mdl/texture";
import {
  encodeRegion,
  REGION_BLADE,
  REGION_HANDLE,
  REGION_NONE,
} from "../src/mdl/regions";
import { encodePng } from "./lib/png";
import { loadModel } from "./lib/software-render";

/** Below this an island is a seam or a stray sliver, not a part. */
const MIN_ISLAND_TEXELS = 200;

/**
 * Knives whose automatic split was wrong when checked against the texture.
 *
 *   distance  the model names a blade bone but weights nearly the whole knife
 *             to it, so the name carries no information and the geometry has
 *             to decide instead
 *   single    no split at all. Better to offer one colour for the whole knife
 *             than to draw a boundary in the wrong place.
 */
const OVERRIDES: Record<string, "distance" | "single"> = {
  "nomad-knife": "distance",
  "navaja-knife": "distance",

  // A push dagger's grip is a crossbar through the fist, so it sits at much
  // the same distance as the blade and the split lands anywhere.
  "shadow-daggers": "single",

  // The hook runs continuously into the body, and every automatic boundary
  // put part of the blade in the handle.
  "gut-knife": "single",
};

const DEBUG = process.env.FAKALAB_DEBUG === "1";

interface Triangle {
  /** Texel-space UV corners. */
  uv: number[];
  /** Centroid in model space, at the pose the knife is measured in. */
  x: number;
  y: number;
  z: number;
  /** What the bone this triangle hangs off says the part is, if anything. */
  named: number;
}

/**
 * Folding knives carry a bone per moving part. Fixed knives put everything on
 * one weapon bone and say nothing, which is what the distance test is for.
 */
function partFromBoneName(name: string): number {
  if (/blade/i.test(name)) return REGION_BLADE;
  if (/front|rear|lock|handle|grip/i.test(name)) return REGION_HANDLE;
  return REGION_NONE;
}

function knifeTriangles(
  model: MdlFile,
  meshes: MeshGeometry[],
  texture: MdlTexture,
  pose: Matrix3x4[],
): Triangle[] {
  const triangles: Triangle[] = [];

  for (const mesh of meshes) {
    if (mesh.texture.index !== texture.index) continue;

    for (let t = 0; t < mesh.triangleCount; t += 1) {
      const i0 = t * 3;
      const uv: number[] = [];
      let cx = 0;
      let cy = 0;
      let cz = 0;
      let named = REGION_NONE;

      for (let k = 0; k < 3; k += 1) {
        const part = partFromBoneName(model.bones[mesh.boneIndices[i0 + k]].name);
        if (part !== REGION_NONE) named = part;
        const v = (i0 + k) * 3;
        uv.push(mesh.uvs[(i0 + k) * 2] * texture.width, mesh.uvs[(i0 + k) * 2 + 1] * texture.height);
        const world = transformPoint(
          pose[mesh.boneIndices[i0 + k]],
          mesh.positions[v],
          mesh.positions[v + 1],
          mesh.positions[v + 2],
        );
        cx += world[0] / 3;
        cy += world[1] / 3;
        cz += world[2] / 3;
      }
      triangles.push({ uv, x: cx, y: cy, z: cz, named });
    }
  }
  return triangles;
}

/** Walks a triangle's texels, calling back with each slot it covers. */
function eachTexel(
  uv: number[],
  width: number,
  height: number,
  visit: (slot: number) => void,
): void {
  const xs = [uv[0], uv[2], uv[4]];
  const ys = [uv[1], uv[3], uv[5]];

  const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
  if (area === 0) return;

  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) / area;
      const w1 = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) / area;
      if (w0 < 0 || w1 < 0 || 1 - w0 - w1 < 0) continue;
      visit(y * width + x);
    }
  }
}

/** Connected components over the used texels, four-way. */
function labelIslands(used: Uint8Array, width: number, height: number): Int32Array {
  const labels = new Int32Array(used.length).fill(-1);
  const stack: number[] = [];
  let next = 0;

  for (let start = 0; start < used.length; start += 1) {
    if (!used[start] || labels[start] >= 0) continue;
    const id = next;
    next += 1;
    labels[start] = id;
    stack.push(start);

    while (stack.length > 0) {
      const slot = stack.pop()!;
      const x = slot % width;
      const y = (slot / width) | 0;
      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const n = ny * width + nx;
        if (!used[n] || labels[n] >= 0) return;
        labels[n] = id;
        stack.push(n);
      };
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
    }
  }
  return labels;
}

/** One-dimensional two-means, which is enough to separate near from far. */
function splitInTwo(values: number[], weights: number[]): number {
  let low = Math.min(...values);
  let high = Math.max(...values);

  for (let pass = 0; pass < 40; pass += 1) {
    let lowSum = 0;
    let lowWeight = 0;
    let highSum = 0;
    let highWeight = 0;

    values.forEach((value, i) => {
      if (Math.abs(value - low) <= Math.abs(value - high)) {
        lowSum += value * weights[i];
        lowWeight += weights[i];
      } else {
        highSum += value * weights[i];
        highWeight += weights[i];
      }
    });

    const nextLow = lowWeight > 0 ? lowSum / lowWeight : low;
    const nextHigh = highWeight > 0 ? highSum / highWeight : high;
    if (nextLow === low && nextHigh === high) break;
    low = nextLow;
    high = nextHigh;
  }
  return (low + high) / 2;
}

const models = join(process.cwd(), "public", "models");
const target = join(process.cwd(), "public", "regions");
await mkdir(target, { recursive: true });

console.log("knife".padEnd(24) + "islands".padStart(8) + "blade%".padStart(8) + "  decided by");

for (const knife of KNIVES) {
  const model = loadModel(join(models, `${knife.slug}.mdl`));
  const geometry = buildGeometry(model);
  const texture = model.textures.find((candidate) => !isHandTexture(candidate));
  if (!texture) continue;

  const { width, height } = texture;

  // Measure where the knife is furthest from the hand, so folding knives are
  // judged open rather than closed.
  const sequence = idleSequence(model);
  const handIndices = model.bones
    .map((bone, index) => (/_Hand$/i.test(bone.name) ? index : -1))
    .filter((index) => index >= 0);
  const hands = handIndices.length > 0 ? handIndices : [0];

  /** Distance to whichever hand is closest, for models held in both. */
  const reachFrom = (pose: Matrix3x4[], x: number, y: number, z: number): number => {
    let nearest = Infinity;
    for (const index of hands) {
      const bone = pose[index];
      const distance = Math.hypot(x - bone[3], y - bone[7], z - bone[11]);
      if (distance < nearest) nearest = distance;
    }
    return nearest;
  };

  let pose = setupBones(model, sequence!, 0);
  let bestReach = -1;
  if (sequence) {
    for (let frame = 0; frame < sequence.numFrames; frame += 5) {
      const candidate = setupBones(model, sequence, frame);
      let reach = 0;

      for (const mesh of geometry.meshes) {
        if (mesh.texture.index !== texture.index) continue;
        for (let i = 0; i < mesh.boneIndices.length; i += 24) {
          const world = transformPoint(
            candidate[mesh.boneIndices[i]],
            mesh.positions[i * 3],
            mesh.positions[i * 3 + 1],
            mesh.positions[i * 3 + 2],
          );
          const distance = reachFrom(candidate, world[0], world[1], world[2]);
          if (distance > reach) reach = distance;
        }
      }
      if (reach > bestReach) {
        bestReach = reach;
        pose = candidate;
      }
    }
  }

  const triangles = knifeTriangles(model, geometry.meshes, texture, pose);

  const used = new Uint8Array(width * height);
  for (const triangle of triangles) {
    eachTexel(triangle.uv, width, height, (slot) => {
      used[slot] = 1;
    });
  }
  const labels = labelIslands(used, width, height);

  // Each island's distance from the hand, plus any votes its bones cast.
  const sums = new Map<number, { distance: number; weight: number; votes: number[] }>();
  for (const triangle of triangles) {
    const distance = reachFrom(pose, triangle.x, triangle.y, triangle.z);
    eachTexel(triangle.uv, width, height, (slot) => {
      const island = labels[slot];
      if (island < 0) return;
      const entry = sums.get(island) ?? { distance: 0, weight: 0, votes: [0, 0, 0] };
      entry.distance += distance;
      entry.weight += 1;
      entry.votes[triangle.named] += 1;
      sums.set(island, entry);
    });
  }

  /** A bone-named island keeps its name; the rest fall through to distance. */
  const named = (entry: { votes: number[] }): number => {
    const blade = entry.votes[REGION_BLADE];
    const handle = entry.votes[REGION_HANDLE];
    if (blade === 0 && handle === 0) return REGION_NONE;
    return blade >= handle ? REGION_BLADE : REGION_HANDLE;
  };

  const islands = [...sums.entries()]
    .filter(([, entry]) => entry.weight >= MIN_ISLAND_TEXELS)
    .map(([id, entry]) => ({
      id,
      distance: entry.distance / entry.weight,
      weight: entry.weight,
      named: named(entry),
    }));

  // Only the islands nothing named take part in the distance split.
  const unnamed =
    OVERRIDES[knife.slug] === "distance"
      ? islands
      : islands.filter((island) => island.named === REGION_NONE);
  const boundary = unnamed.length
    ? splitInTwo(
        unnamed.map((island) => island.distance),
        unnamed.map((island) => island.weight),
      )
    : Infinity;

  const override = OVERRIDES[knife.slug];

  const region = new Map<number, number>();
  for (const [id, entry] of sums) {
    if (override === "single") {
      region.set(id, REGION_HANDLE);
      continue;
    }
    const vote = override === "distance" ? REGION_NONE : named(entry);
    region.set(
      id,
      vote !== REGION_NONE
        ? vote
        : entry.distance / entry.weight >= boundary ? REGION_BLADE : REGION_HANDLE,
    );
  }

  const bonesSpoke = override !== "distance" && islands.some((i) => i.named !== REGION_NONE);

  // Green channel: position along the knife, grip to tip.
  let nearestReach = Infinity;
  let farthestReach = -Infinity;
  for (const triangle of triangles) {
    const distance = reachFrom(pose, triangle.x, triangle.y, triangle.z);
    if (distance < nearestReach) nearestReach = distance;
    if (distance > farthestReach) farthestReach = distance;
  }
  const reachSpan = Math.max(1e-6, farthestReach - nearestReach);

  const axis = new Uint8Array(width * height);
  for (const triangle of triangles) {
    const along =
      (reachFrom(pose, triangle.x, triangle.y, triangle.z) - nearestReach) / reachSpan;
    const value = Math.round(Math.min(1, Math.max(0, along)) * 255);
    eachTexel(triangle.uv, width, height, (slot) => {
      axis[slot] = value;
    });
  }

  const mask = new Uint8Array(width * height * 3);
  let blade = 0;
  let total = 0;
  for (let slot = 0; slot < labels.length; slot += 1) {
    const id = labels[slot];
    const value = id < 0 ? REGION_NONE : (region.get(id) ?? REGION_HANDLE);
    mask[slot * 3] = encodeRegion(value);
    mask[slot * 3 + 1] = axis[slot];
    if (value === REGION_NONE) continue;
    total += 1;
    if (value === REGION_BLADE) blade += 1;
  }

  await writeFile(
    join(target, `${knife.slug}.png`),
    encodePng(width, height, mask),
  );

  console.log(
    knife.slug.padEnd(24) +
      String(islands.length).padStart(8) +
      `${((blade / total) * 100).toFixed(0)}%`.padStart(8) +
      (override === "single" ? "  one region" : bonesSpoke ? "  bones" : "  distance") +
      (override ? "  (set by hand)" : ""),
  );

  if (DEBUG) {
    const rgba = decodeToRgba(readPixels(model, texture), readPalette(model, texture));
    const preview = new Uint8Array(width * height * 3);
    for (let slot = 0; slot < width * height; slot += 1) {
      const value = mask[slot * 3];
      // Region as hue, position along the knife as brightness.
      const along = 0.35 + (mask[slot * 3 + 1] / 255) * 0.65;
      const tint =
        value === REGION_BLADE ? [90, 170, 240] : value === REGION_HANDLE ? [240, 150, 60] : null;
      for (let c = 0; c < 3; c += 1) {
        const base = rgba[slot * 4 + c];
        preview[slot * 3 + c] = tint ? (base * 0.3 + tint[c] * 0.7) * along : base * 0.2;
      }
    }
    await writeFile(
      join(process.cwd(), "node_modules", ".tmp", `regions-${knife.slug}.png`),
      encodePng(width, height, preview),
    );
  }
}

console.log(`\n${KNIVES.length} region masks in public/regions`);
