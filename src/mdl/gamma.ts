/**
 * The engine's gamma pipeline, from GoldSrc's BuildGammaTable.
 *
 * This is the piece that makes a texture drawn flat in a browser look nothing
 * like the same texture in game. Two separate curves are involved and they are
 * applied at different points:
 *
 *   - texture gamma, applied to palette colors when a texture is uploaded
 *   - light gamma, applied to the per-vertex brightness the studio renderer
 *     computes, before it multiplies the texel
 *
 * Both are driven by the player's own cvars, so "what the game looks like"
 * genuinely differs between two people running the same map.
 *
 * These curves are for display only. Exported models keep their raw palette,
 * because the engine applies all of this itself; baking it into the file would
 * gamma-correct the colors twice.
 */

export interface GammaSettings {
  /** `gamma` cvar. */
  gamma: number;
  /** `texgamma` cvar. */
  texGamma: number;
  /** `lightgamma` cvar. */
  lightGamma: number;
  /** `brightness` cvar. */
  brightness: number;
}

/** GoldSrc defaults. Players do change these, which changes what they see. */
export const DEFAULT_GAMMA: GammaSettings = {
  gamma: 2.5,
  texGamma: 2.0,
  lightGamma: 2.5,
  brightness: 0,
};

/**
 * Lookup table mapping a raw palette byte to what the engine actually uploads.
 * With the default cvars the exponent is 0.8, which lifts midtones noticeably.
 */
export function textureGammaTable({ gamma, texGamma }: GammaSettings): Uint8Array {
  const exponent = texGamma / gamma;
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    table[i] = Math.min(255, Math.max(0, Math.round(Math.pow(i / 255, exponent) * 255)));
  }
  return table;
}

/**
 * The knee the light curve pivots around. Below it the response is linear into
 * the darkest eighth; above it, linear across the rest.
 */
export function brightenPoint(brightness: number): number {
  const clamped = Math.min(1, Math.max(0, brightness));
  return 0.125 - clamped * clamped * 0.075;
}

/** Uniform values the studio shader needs to reproduce the light curve. */
export function lightGammaUniforms(settings: GammaSettings) {
  return {
    gamma: settings.gamma,
    lightGamma: settings.lightGamma,
    brighten: brightenPoint(settings.brightness),
    brightnessScale: Math.max(settings.brightness, 1),
  };
}
