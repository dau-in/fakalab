/**
 * The GoldSrc studio shading model, ported from R_StudioLighting and the
 * engine's gamma curve, and cross-checked against csgl3's reimplementation of
 * the same renderer.
 *
 * One brightness scalar per vertex, run through the light gamma curve, then
 * multiplied over the texel. No specular, no shadows, no per-pixel work.
 * Reproducing it exactly is the whole point of the preview: a physically based
 * material would look better in the browser and lie about the game.
 */

import {
  DataTexture,
  DoubleSide,
  LinearMipmapLinearFilter,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
} from "three";

import { DEFAULT_GAMMA, lightGammaUniforms, type GammaSettings } from "../mdl/gamma";

/** The engine's v_lambert1. Values above 1 soften the terminator. */
const LAMBERT = 1.4953241;

const vertexShader = /* glsl */ `
  uniform vec3 uLightVec;
  uniform float uAmbient;
  uniform float uShade;

  uniform float uGamma;
  uniform float uLightGamma;
  uniform float uBrighten;
  uniform float uBrightnessScale;

  varying vec2 vUv;
  varying float vLight;

  // BuildGammaTable's light curve: a power law, then a two-piece remap that
  // keeps the darkest eighth of the range from crushing.
  float applyBrightness(float x) {
    float light = pow(x, uLightGamma) * uBrightnessScale;
    light = light > uBrighten
      ? 0.125 + ((light - uBrighten) / (1.0 - uBrighten)) * 0.875
      : (light / uBrighten) * 0.125;
    return clamp(pow(light, 1.0 / uGamma), 0.0, 1.0);
  }

  void main() {
    vUv = uv;

    // Normals arrive in GoldSrc world space, matching the light vector, so the
    // scene's own orientation never affects the shading.
    float NdotL = dot(normalize(normal), uLightVec);
    float diffuse = min((1.0 - NdotL) / ${LAMBERT}, 1.0);
    vLight = applyBrightness(uAmbient + uShade * diffuse);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;

  varying vec2 vUv;
  varying float vLight;

  void main() {
    vec4 texel = texture2D(uMap, vUv);
    gl_FragColor = vec4(texel.rgb * vLight, 1.0);
  }
`;

export interface Lighting {
  /** The engine's ambientlight, 0-255. */
  ambient: number;
  /** The engine's shadelight, 0-255. ambient + shade is clamped to 255. */
  shade: number;
  /** Light direction in GoldSrc space (x forward, y left, z up). */
  direction: [number, number, number];
  gamma: GammaSettings;
}

/**
 * A plausible lit interior. The engine samples ambientlight and shadelight from
 * the map at the player's position, so these are the one part of the pipeline
 * that is a choice rather than a port.
 */
export const DEFAULT_LIGHTING: Lighting = {
  ambient: 40,
  shade: 170,
  direction: [0.3, 0.5, -0.8],
  gamma: DEFAULT_GAMMA,
};

/** The caller keeps the pixel array so recoloring can refill it in place. */
export function createTexture(data: Uint8Array, width: number, height: number): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat);
  // GoldSrc point-samples up close; mipmaps only smooth the minified case.
  texture.magFilter = NearestFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function applyLighting(material: ShaderMaterial, lighting: Lighting): void {
  const curve = lightGammaUniforms(lighting.gamma);
  const { uniforms } = material;

  uniforms.uAmbient.value = lighting.ambient / 255;
  uniforms.uShade.value = lighting.shade / 255;
  uniforms.uLightVec.value.set(...lighting.direction).normalize();
  uniforms.uGamma.value = curve.gamma;
  uniforms.uLightGamma.value = curve.lightGamma;
  uniforms.uBrighten.value = curve.brighten;
  uniforms.uBrightnessScale.value = curve.brightnessScale;
}

export function createMaterial(map: DataTexture, lighting: Lighting): ShaderMaterial {
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    // Viewmodel meshes are open shells; culling them drops visible faces.
    side: DoubleSide,
    uniforms: {
      uMap: { value: map },
      uAmbient: { value: 0 },
      uShade: { value: 0 },
      uLightVec: { value: new Vector3() },
      uGamma: { value: 2.5 },
      uLightGamma: { value: 2.5 },
      uBrighten: { value: 0.125 },
      uBrightnessScale: { value: 1 },
    },
  });
  applyLighting(material, lighting);
  return material;
}
