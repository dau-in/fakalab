/**
 * Checks the lighting fit against renders whose values are known in advance.
 *
 * Going back into the game for more screenshots is expensive, and two earlier
 * approaches both produced confident numbers that meant nothing. So the
 * estimator is tested on synthetic frames first: render the knife at known
 * ambientlight and shadelight over an adversarial background, run the exact
 * fit the real screenshots will go through, and see whether the values return.
 *
 * Two masks are tested separately, because they fail for different reasons:
 *
 *   perfect  the renderer's own coverage buffer. Isolates the estimator.
 *   median   the per-pixel median across frames, which is what real
 *            screenshots have to use. Isolates the masking.
 *
 * The fit never sees which frame produced a screenshot: candidates are spread
 * across the whole idle animation, exactly as with real captures.
 *
 *   npx esbuild scripts/verify-calibration.ts --bundle --platform=node \
 *     --format=esm --outfile=node_modules/.tmp/verify-cal.mjs
 *   node node_modules/.tmp/verify-cal.mjs
 */

import { join } from "node:path";

import { idleSequence } from "../src/mdl/animation";
import type { GammaSettings } from "../src/mdl/gamma";
import {
  backgroundMedian,
  fitAcrossFrames,
  foregroundMask,
  modelSamples,
  observedPeaks,
  REGION,
  type Bitmap,
} from "./lib/fit-lighting";
import { buildGeometry, loadModel, render } from "./lib/software-render";

/** The player's own video settings, read from their console. */
const PLAYER_GAMMA: GammaSettings = {
  gamma: 3,
  brightness: 2,
  texGamma: 2.0,
  lightGamma: 2.5,
};

const DIRECTION: [number, number, number] = [0.3, 0.5, -0.8];
const WIDTH = 1366;
const HEIGHT = 768;

/** One second apart at 30 fps, which is what pressing the key five times gives. */
const CAPTURE_FRAMES = [10, 40, 70, 100, 130];

/** Poses the fit may choose from, every fifth frame of the animation. */
const CANDIDATE_FRAMES = Array.from({ length: 38 }, (_, i) => i * 5);

const CASES = [
  { name: "bright outdoor", ambient: 40, shade: 170 },
  { name: "lit interior", ambient: 25, shade: 130 },
  { name: "dim", ambient: 12, shade: 80 },
  { name: "very dark", ambient: 6, shade: 40 },
  { name: "flat ambient", ambient: 90, shade: 20 },
];

/**
 * Sand, roughly the tone of de_dust2's walls, with enough variation to land
 * across the same chromaticity band as skin. Deterministic so runs compare.
 */
function sandBackground(): Uint8Array {
  const out = new Uint8Array(WIDTH * HEIGHT * 3);
  let seed = 0x2f6e2b1;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const block = Math.sin(x * 0.017) * 18 + Math.cos(y * 0.021) * 14;
      const level = 118 + block + (random() - 0.5) * 46;
      const d = (y * WIDTH + x) * 3;
      out[d] = Math.min(255, Math.max(0, level * 1.06));
      out[d + 1] = Math.min(255, Math.max(0, level * 0.93));
      out[d + 2] = Math.min(255, Math.max(0, level * 0.68));
    }
  }
  return out;
}

/** Restricts a coverage buffer to the same window the real masking uses. */
function clipToRegion(coverage: Uint8Array): Uint8Array {
  const out = new Uint8Array(coverage.length);
  const x0 = Math.floor(WIDTH * REGION.x0);
  const x1 = Math.floor(WIDTH * REGION.x1);
  const y0 = Math.floor(HEIGHT * REGION.y0);
  const y1 = Math.floor(HEIGHT * REGION.y1);

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) out[y * WIDTH + x] = coverage[y * WIDTH + x];
  }
  return out;
}

const model = loadModel(join(process.cwd(), "public", "models", "bayonet-knife.mdl"));
const geometry = buildGeometry(model);
const sequence = idleSequence(model);
if (!sequence) throw new Error("bayonet has no sequences");

const background = sandBackground();

/** Reference poses the fit searches over. Lighting here is irrelevant: the
 * stored terms are lighting independent. */
const candidates = CANDIDATE_FRAMES.map((frame) =>
  modelSamples(
    render({
      model,
      geometry,
      sequence,
      frame,
      lighting: { ambient: 0, shade: 255, direction: DIRECTION, gamma: PLAYER_GAMMA },
      width: WIDTH,
      height: HEIGHT,
    }),
  ),
);

console.log("background: generated sand, adversarial for skin chromaticity");
console.log(`captures at frames ${CAPTURE_FRAMES.join(", ")} of ${sequence.numFrames}`);
console.log(`fit chooses from poses ${CANDIDATE_FRAMES.join(", ")}\n`);
console.log(
  "case".padEnd(16) +
    "truth".padStart(10) +
    "perfect mask".padStart(15) +
    "median mask".padStart(14),
);

const worst = { perfect: 0, median: 0 };

for (const testCase of CASES) {
  const lighting = {
    ambient: testCase.ambient,
    shade: testCase.shade,
    direction: DIRECTION,
    gamma: PLAYER_GAMMA,
  };

  const rendered = CAPTURE_FRAMES.map((frame) =>
    render({ model, geometry, sequence, frame, lighting, width: WIDTH, height: HEIGHT, background }),
  );
  const frames: Bitmap[] = rendered.map((r) => ({ width: WIDTH, height: HEIGHT, rgb: r.rgb }));

  const perfect = fitAcrossFrames(
    candidates,
    frames.map((frame, i) => observedPeaks(frame, clipToRegion(rendered[i].coverage))),
    PLAYER_GAMMA,
  );

  const median = backgroundMedian(frames);
  const medianFit = fitAcrossFrames(
    candidates,
    frames.map((frame) => observedPeaks(frame, foregroundMask(frame, median))),
    PLAYER_GAMMA,
  );

  const error = (fit: { ambient: number; shade: number }) =>
    Math.max(
      Math.abs(fit.ambient - testCase.ambient),
      Math.abs(fit.shade - testCase.shade),
    );
  worst.perfect = Math.max(worst.perfect, error(perfect));
  worst.median = Math.max(worst.median, error(medianFit));

  console.log(
    testCase.name.padEnd(16) +
      `${testCase.ambient}/${testCase.shade}`.padStart(10) +
      `${perfect.ambient}/${perfect.shade}`.padStart(15) +
      `${medianFit.ambient}/${medianFit.shade}`.padStart(14),
  );
}

console.log(`\nworst error, perfect mask: ${worst.perfect.toFixed(0)}`);
console.log(`worst error, median mask:  ${worst.median.toFixed(0)}`);
