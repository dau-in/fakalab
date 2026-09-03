/**
 * Recovers ambientlight and shadelight from in-game screenshots.
 *
 * Three approaches were tried before this one, and the first two are worth
 * recording because they both looked reasonable and both produced numbers that
 * were quietly meaningless:
 *
 *   1. Find the hands by chromaticity, then divide the observed brightness by
 *      the source texel's brightness to recover the light level. Chromaticity
 *      does not identify a texel: a shaded skin texture holds hundreds of
 *      texels at one hue and many brightnesses, so the nearest match is an
 *      arbitrary member of that set and the division is noise. Tested against
 *      renders with known values and a perfect mask, it returned roughly the
 *      same answer for lighting from 6/40 to 90/20.
 *   2. Before that, chromaticity with no mask at all measured the sand walls of
 *      de_dust2 rather than the player's arms.
 *
 * What works instead is not identifying anything. Render the same model, keep
 * the two halves of the lighting equation apart, and compare the *distribution*
 * of brightness in the render against the distribution in the screenshot. Both
 * sides use the same textures, so the comparison is like for like and no texel
 * ever has to be matched to a pixel.
 *
 * Since a rendered pixel is `texelPeak * lightGamma(ambient + shade * diffuse)`
 * and the two stored terms do not depend on the lighting, any candidate pair
 * can be scored without rasterizing again.
 */

import { applyLightGamma } from "../../src/mdl/lighting";
import type { GammaSettings } from "../../src/mdl/gamma";
import type { RenderResult } from "./software-render";

export interface Bitmap {
  width: number;
  height: number;
  rgb: Uint8Array;
}

/** Screen area the viewmodel can occupy, clear of the HUD along the bottom. */
export const REGION = { x0: 0.02, x1: 0.98, y0: 0.3, y1: 0.94 };

/** How far a pixel must sit from the background median to be viewmodel. */
const FOREGROUND_THRESHOLD = 14;

/** Brightness histogram resolution used to compare the two distributions. */
const BINS = 64;

/** Enough for a stable histogram, few enough to score thousands of times. */
const SAMPLE_LIMIT = 4000;

/**
 * Per-pixel median across frames. The map does not move between shots, so the
 * median is the map, provided the arms leave each pixel uncovered in at least
 * half the frames. More frames make that safer.
 */
export function backgroundMedian(frames: Bitmap[]): Uint8Array {
  const { width, height } = frames[0];
  const out = new Uint8Array(width * height * 3);
  const values: number[] = new Array(frames.length);

  for (let i = 0; i < width * height * 3; i += 1) {
    for (let f = 0; f < frames.length; f += 1) values[f] = frames[f].rgb[i];
    values.sort((a, b) => a - b);
    out[i] = values[values.length >> 1];
  }
  return out;
}

/** Marks pixels of one frame that depart from the background. */
export function foregroundMask(frame: Bitmap, background: Uint8Array): Uint8Array {
  const { width, height } = frame;
  const mask = new Uint8Array(width * height);

  const x0 = Math.floor(width * REGION.x0);
  const x1 = Math.floor(width * REGION.x1);
  const y0 = Math.floor(height * REGION.y0);
  const y1 = Math.floor(height * REGION.y1);

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const slot = y * width + x;
      const o = slot * 3;
      const delta = Math.max(
        Math.abs(frame.rgb[o] - background[o]),
        Math.abs(frame.rgb[o + 1] - background[o + 1]),
        Math.abs(frame.rgb[o + 2] - background[o + 2]),
      );
      if (delta >= FOREGROUND_THRESHOLD) mask[slot] = 1;
    }
  }
  return mask;
}

/** Evenly thinned so the sample keeps the shape of the whole distribution. */
function thin(values: number[], limit: number): number[] {
  if (values.length <= limit) return values;
  const step = values.length / limit;
  const out: number[] = new Array(limit);
  for (let i = 0; i < limit; i += 1) out[i] = values[Math.floor(i * step)];
  return out;
}

/** Observed brightness of the masked pixels of one frame. */
export function observedPeaks(frame: Bitmap, mask: Uint8Array): number[] {
  const peaks: number[] = [];
  for (let slot = 0; slot < mask.length; slot += 1) {
    if (!mask[slot]) continue;
    const o = slot * 3;
    peaks.push(Math.max(frame.rgb[o], frame.rgb[o + 1], frame.rgb[o + 2]));
  }
  peaks.sort((a, b) => a - b);
  return thin(peaks, SAMPLE_LIMIT);
}

export interface ModelSamples {
  texelPeak: Float32Array;
  diffuse: Float32Array;
}

/** The lighting-independent halves of a render, ready to be scored. */
export function modelSamples(rendered: RenderResult): ModelSamples {
  const indices: number[] = [];
  for (let slot = 0; slot < rendered.coverage.length; slot += 1) {
    if (rendered.coverage[slot]) indices.push(slot);
  }

  const step = indices.length > SAMPLE_LIMIT ? indices.length / SAMPLE_LIMIT : 1;
  const count = Math.min(indices.length, SAMPLE_LIMIT);
  const texelPeak = new Float32Array(count);
  const diffuse = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const slot = indices[Math.floor(i * step)];
    texelPeak[i] = rendered.texelPeak[slot];
    diffuse[i] = rendered.diffuse[slot];
  }
  return { texelPeak, diffuse };
}

/** Normalized cumulative brightness distribution, over 0-255 in BINS steps. */
function cumulativeHistogram(values: ArrayLike<number>): Float64Array {
  const bins = new Float64Array(BINS);
  for (let i = 0; i < values.length; i += 1) {
    const bin = Math.min(BINS - 1, (values[i] * BINS) / 256) | 0;
    bins[bin] += 1;
  }

  let running = 0;
  for (let i = 0; i < BINS; i += 1) {
    running += bins[i];
    bins[i] = running;
  }
  if (running > 0) for (let i = 0; i < BINS; i += 1) bins[i] /= running;
  return bins;
}

export function observedHistogram(peaks: number[]): Float64Array {
  return cumulativeHistogram(peaks);
}

/**
 * Distance between two brightness distributions: the area between their
 * cumulative curves. Comparing whole distributions rather than a handful of
 * quantiles uses every pixel and needs no sorting, which keeps the search fast
 * enough to try every pose.
 */
function scoreCandidate(
  model: ModelSamples,
  observed: Float64Array,
  ambient: number,
  shade: number,
  gamma: GammaSettings,
  bins: Float64Array,
): number {
  bins.fill(0);
  const a = ambient / 255;
  const s = shade / 255;

  for (let i = 0; i < model.diffuse.length; i += 1) {
    const level = applyLightGamma(a + s * model.diffuse[i], gamma);
    const value = Math.min(255, model.texelPeak[i] * level);
    bins[Math.min(BINS - 1, (value * BINS) / 256) | 0] += 1;
  }

  let running = 0;
  let error = 0;
  const total = model.diffuse.length;
  for (let i = 0; i < BINS; i += 1) {
    running += bins[i];
    error += Math.abs(running / total - observed[i]);
  }
  return error;
}

export interface FitResult {
  ambient: number;
  shade: number;
  /** Which of the candidate renders matched best. */
  frameIndex: number;
  error: number;
}

/**
 * Grid searches ambient and shade against every candidate pose, coarse then
 * fine. The pose in a screenshot is unknown, so it is searched alongside the
 * lighting; getting it wrong skews how much contrast the arms show, which is
 * exactly what separates ambient from shade.
 */
export function fitLighting(
  candidates: ModelSamples[],
  observedPeaks: number[],
  gamma: GammaSettings,
): FitResult {
  const observed = cumulativeHistogram(observedPeaks);
  const bins = new Float64Array(BINS);

  let best: FitResult = { ambient: 0, shade: 0, frameIndex: 0, error: Infinity };

  const search = (
    ambientRange: [number, number],
    shadeRange: [number, number],
    step: number,
    poses: number[],
  ) => {
    for (const index of poses) {
      const model = candidates[index];
      for (let ambient = ambientRange[0]; ambient <= ambientRange[1]; ambient += step) {
        for (let shade = shadeRange[0]; shade <= shadeRange[1]; shade += step) {
          if (ambient + shade > 255) continue; // the engine clamps the sum
          const error = scoreCandidate(model, observed, ambient, shade, gamma, bins);
          if (error < best.error) best = { ambient, shade, frameIndex: index, error };
        }
      }
    }
  };

  const everyPose = candidates.map((_, i) => i);
  search([0, 160], [0, 255], 6, everyPose);

  const around = (value: number, span: number, max: number): [number, number] => [
    Math.max(0, value - span),
    Math.min(max, value + span),
  ];
  search(around(best.ambient, 6, 200), around(best.shade, 6, 255), 1, [best.frameIndex]);

  return best;
}

/**
 * Fits each captured frame on its own and takes the median. Pooling frames
 * would mix several poses into one distribution while comparing it against a
 * single pose, which blurs the very contrast the split depends on.
 */
export function fitAcrossFrames(
  candidates: ModelSamples[],
  perFramePeaks: number[][],
  gamma: GammaSettings,
): FitResult {
  const fits = perFramePeaks
    .filter((peaks) => peaks.length > 200)
    .map((peaks) => fitLighting(candidates, peaks, gamma));
  if (fits.length === 0) return { ambient: 0, shade: 0, frameIndex: 0, error: Infinity };

  const median = (pick: (fit: FitResult) => number) => {
    const values = fits.map(pick).sort((a, b) => a - b);
    return values[values.length >> 1];
  };

  return {
    ambient: median((f) => f.ambient),
    shade: median((f) => f.shade),
    frameIndex: fits[0].frameIndex,
    error: median((f) => f.error),
  };
}
