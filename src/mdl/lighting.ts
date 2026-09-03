/**
 * CPU twin of the studio shading in `src/three/goldsrcMaterial.ts`.
 *
 * The renderer needs this in GLSL and the offline pose renderer needs it in
 * TypeScript, so the two exist side by side. Change one and change the other.
 */

import { brightenPoint, type GammaSettings } from "./gamma";

/** The engine's v_lambert1. */
export const LAMBERT = 1.4953241;

/**
 * R_StudioLighting. Returns the raw illumination before gamma, where `ambient`
 * and `shade` are the engine's 0-255 values scaled to 0-1.
 */
export function studioIllum(
  nx: number,
  ny: number,
  nz: number,
  light: readonly [number, number, number],
  ambient: number,
  shade: number,
): number {
  const length = Math.hypot(nx, ny, nz) || 1;
  const ndotl = (nx * light[0] + ny * light[1] + nz * light[2]) / length;
  return ambient + shade * Math.min((1 - ndotl) / LAMBERT, 1);
}

/** BuildGammaTable's light curve. */
export function applyLightGamma(x: number, settings: GammaSettings): number {
  const brighten = brightenPoint(settings.brightness);
  let light = Math.pow(Math.max(x, 0), settings.lightGamma) * Math.max(settings.brightness, 1);

  light =
    light > brighten
      ? 0.125 + ((light - brighten) / (1 - brighten)) * 0.875
      : (light / brighten) * 0.125;

  return Math.min(1, Math.max(0, Math.pow(light, 1 / settings.gamma)));
}
