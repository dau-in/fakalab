import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, Group, Matrix4, type Mesh } from "three";

import { idleSequence, setupBones } from "../mdl/animation";
import { buildGeometry, poseInto } from "../mdl/geometry";
import { isHandTexture, type MdlFile } from "../mdl/parse";
import { decodeToRgba, readPalette, readPixels } from "../mdl/texture";
import type { RecoloredTexture } from "../mdl/recolor";
import { createMaterial, createTexture, DEFAULT_LIGHTING, type Lighting } from "./goldsrcMaterial";

/**
 * GoldSrc is Z-up with X forward and Y to the left. This maps that onto
 * three.js's Y-up right-handed space, so the default camera at the origin
 * looks down GoldSrc +X exactly as the player does.
 */
const GOLDSRC_TO_THREE = new Matrix4().set(0, -1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1);

/** Roughly where the knife sits once the idle animation has it in hand. */
const FREE_TARGET: [number, number, number] = [6, -5, -14];

interface KnifeProps {
  model: MdlFile;
  recolored: RecoloredTexture[];
  lighting: Lighting;
  playing: boolean;
}

function Knife({ model, recolored, lighting, playing }: KnifeProps) {
  const group = useRef<Group>(null);
  const meshes = useRef<Mesh[]>([]);
  const elapsed = useRef(0);

  const geometry = useMemo(() => buildGeometry(model), [model]);
  const sequence = useMemo(() => idleSequence(model), [model]);

  // One geometry and one material per mesh, rebuilt only when the model does.
  const built = useMemo(() => {
    return geometry.meshes.map((mesh) => {
      const buffer = new BufferGeometry();
      buffer.setAttribute("position", new BufferAttribute(new Float32Array(mesh.positions), 3));
      buffer.setAttribute("normal", new BufferAttribute(new Float32Array(mesh.normals), 3));
      buffer.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));

      const rgba = decodeToRgba(readPixels(model, mesh.texture), readPalette(model, mesh.texture));
      const data = new Uint8Array(rgba.buffer.slice(0));
      const texture = createTexture(data, mesh.texture.width, mesh.texture.height);
      return { mesh, buffer, texture, data, material: createMaterial(texture, lighting) };
      // Lighting is applied through uniforms below, so it is not a dependency.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    });
  }, [geometry, model]);

  useEffect(() => {
    return () => {
      for (const item of built) {
        item.buffer.dispose();
        item.texture.dispose();
        item.material.dispose();
      }
    };
  }, [built]);

  // Recoloring only rewrites palettes, so the texture is re-decoded in place
  // and the geometry is untouched.
  useEffect(() => {
    for (const item of built) {
      const replacement = recolored.find((entry) => entry.texture.index === item.mesh.texture.index);
      if (!replacement && isHandTexture(item.mesh.texture)) continue;

      const palette = replacement ? replacement.palette : readPalette(model, item.mesh.texture);
      const rgba = decodeToRgba(readPixels(model, item.mesh.texture), palette);
      item.data.set(new Uint8Array(rgba.buffer));
      item.texture.needsUpdate = true;
    }
  }, [built, recolored, model]);

  useEffect(() => {
    for (const item of built) {
      item.material.uniforms.uAmbient.value = lighting.ambient;
      item.material.uniforms.uShade.value = lighting.shade;
      item.material.uniforms.uLightVec.value.set(...lighting.direction).normalize();
    }
  }, [built, lighting]);

  useFrame((_, delta) => {
    if (!sequence) return;
    if (playing) elapsed.current += delta;

    const frame = Math.floor(elapsed.current * sequence.fps) % Math.max(1, sequence.numFrames);
    const bones = setupBones(model, sequence, frame);

    built.forEach((item, index) => {
      const target = meshes.current[index];
      if (!target) return;
      const position = target.geometry.getAttribute("position") as BufferAttribute;
      const normal = target.geometry.getAttribute("normal") as BufferAttribute;

      poseInto(item.mesh, bones, position.array as Float32Array, normal.array as Float32Array);
      position.needsUpdate = true;
      normal.needsUpdate = true;
      target.geometry.computeBoundingSphere();
    });
  });

  return (
    <group ref={group} matrixAutoUpdate={false} matrix={GOLDSRC_TO_THREE}>
      {built.map((item, index) => (
        <mesh
          key={item.mesh.texture.name + index}
          ref={(node) => {
            if (node) meshes.current[index] = node;
          }}
          geometry={item.buffer}
          material={item.material}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}

/**
 * Game view puts the eye exactly where the engine does: at the origin, looking
 * down GoldSrc +X. Free view pulls back so the knife can be inspected.
 *
 * r3f only applies the Canvas `camera` prop when the camera is created, so
 * switching views has to move it directly.
 */
function CameraRig({ free }: { free: boolean }) {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    if (free) {
      camera.position.set(24, 4, 6);
      camera.lookAt(FREE_TARGET[0], FREE_TARGET[1], FREE_TARGET[2]);
    } else {
      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0, -1);
    }
    camera.updateProjectionMatrix();
  }, [camera, free]);

  return null;
}

interface Props {
  model: MdlFile | null;
  recolored: RecoloredTexture[];
  lighting?: Lighting;
  /** Game view frames the model exactly as the engine does; free view orbits. */
  free?: boolean;
  playing?: boolean;
}

export function Viewport({ model, recolored, lighting = DEFAULT_LIGHTING, free = false, playing = true }: Props) {
  return (
    <Canvas
      // The eye sits at the origin, which is where GoldSrc draws viewmodels from.
      camera={{ position: [0, 0, 0], fov: 90, near: 0.5, far: 400 }}
      gl={{ antialias: true }}
      dpr={[1, 2]}
    >
      <CameraRig free={free} />
      {model && (
        <Knife model={model} recolored={recolored} lighting={lighting} playing={playing} />
      )}
      {free && <OrbitControls target={FREE_TARGET} enablePan makeDefault />}
    </Canvas>
  );
}
