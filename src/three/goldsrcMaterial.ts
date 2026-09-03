/**
 * The GoldSrc studio shading model, ported from R_StudioLighting.
 *
 * The engine computes one brightness scalar per vertex and multiplies the
 * texel by it. There is no specular term, no shadowing and no per-pixel work:
 *
 *   illum = ambient + shade
 *   illum -= shade * ((dot(normal, lightvec) + SHADE_LAMBERT - 1) / SHADE_LAMBERT)
 *
 * Reproducing it exactly is the whole point of the preview. A physically based
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

/** Valve's constant. Values above 1 bend the falloff into a soft hemisphere. */
const SHADE_LAMBERT = 1.495;

const vertexShader = /* glsl */ `
  uniform vec3 uLightVec;
  uniform float uAmbient;
  uniform float uShade;

  varying vec2 vUv;
  varying float vLight;

  void main() {
    vUv = uv;

    // Normals arrive in GoldSrc world space, matching the light vector, so the
    // scene's own orientation never affects the shading.
    float lightcos = min(dot(normalize(normal), uLightVec), 1.0);

    float illum = uAmbient + uShade;
    lightcos = (lightcos + (${SHADE_LAMBERT.toFixed(3)} - 1.0)) / ${SHADE_LAMBERT.toFixed(3)};
    if (lightcos > 0.0) {
      illum -= uShade * lightcos;
    }
    vLight = clamp(illum, 0.0, 255.0) / 255.0;

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
  /** Base light everywhere, 0-255 as the engine stores it. */
  ambient: number;
  /** Directional contribution, 0-255. ambient + shade is clamped to 255. */
  shade: number;
  /** Light direction in GoldSrc space (x forward, y left, z up). */
  direction: [number, number, number];
}

/** Roughly a lit indoor spot; calibrated properly against in-game captures. */
export const DEFAULT_LIGHTING: Lighting = {
  ambient: 40,
  shade: 170,
  direction: [0.3, 0.5, -0.8],
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

export function createMaterial(map: DataTexture, lighting: Lighting): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    // Viewmodel meshes are open shells; culling them drops visible faces.
    side: DoubleSide,
    uniforms: {
      uMap: { value: map },
      uAmbient: { value: lighting.ambient },
      uShade: { value: lighting.shade },
      uLightVec: { value: new Vector3(...lighting.direction).normalize() },
    },
  });
}
