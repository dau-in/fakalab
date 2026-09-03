/**
 * Turns a studio model's meshes into flat vertex arrays.
 *
 * Triangles are not stored as a plain list. Each mesh holds a command list of
 * strips and fans: an int16 count, then that many 4 x int16 records
 * (vertex, normal, s, t), repeating until a count of zero. A positive count
 * starts a strip, a negative one a fan.
 *
 * Vertex and normal indices are local to the sub-model that owns the mesh, and
 * s/t are raw pixel coordinates rather than normalized UVs.
 *
 * Positions come out in bone-local space with one bone index per vertex, so
 * posing is a matrix lookup the GPU can do every frame.
 */

import { transformPoint, rotateVector, type Matrix3x4 } from "./bones";
import type { MdlFile, MdlSubModel, MdlTexture } from "./parse";

/** One draw call: the geometry that shares a single texture. */
export interface MeshGeometry {
  texture: MdlTexture;
  /** Bone-local vertex positions. Pose them through `boneIndices`. */
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** GoldSrc binds each vertex to exactly one bone; there are no blend weights. */
  boneIndices: Float32Array;
  triangleCount: number;
}

export interface ModelGeometry {
  meshes: MeshGeometry[];
}

/** Resolves a mesh's skinRef through the skin table to a real texture. */
function textureFor(model: MdlFile, skinRef: number): MdlTexture {
  const family = model.header.numSkinRef > 0 ? model.skinTable[skinRef] : skinRef;
  return model.textures[family] ?? model.textures[skinRef] ?? model.textures[0];
}

interface Corner {
  vertex: number;
  normal: number;
  s: number;
  t: number;
}

/** Walks one mesh's command list and returns its triangles as corner triples. */
function expandTriangles(view: DataView, triIndex: number): Corner[] {
  const triangles: Corner[] = [];
  let offset = triIndex;

  for (;;) {
    const count = view.getInt16(offset, true);
    offset += 2;
    if (count === 0) break;

    const length = Math.abs(count);
    const fan = count < 0;

    const run: Corner[] = [];
    for (let i = 0; i < length; i += 1) {
      run.push({
        vertex: view.getUint16(offset, true),
        normal: view.getUint16(offset + 2, true),
        s: view.getInt16(offset + 4, true),
        t: view.getInt16(offset + 6, true),
      });
      offset += 8;
    }

    if (fan) {
      for (let i = 1; i + 1 < length; i += 1) {
        triangles.push(run[0], run[i], run[i + 1]);
      }
    } else {
      // Strips alternate winding, so every other triangle swaps its first two
      // corners to keep the front face consistent.
      for (let i = 0; i + 2 < length; i += 1) {
        if (i % 2 === 0) triangles.push(run[i], run[i + 1], run[i + 2]);
        else triangles.push(run[i + 1], run[i], run[i + 2]);
      }
    }
  }

  return triangles;
}

function buildMesh(
  model: MdlFile,
  subModel: MdlSubModel,
  triIndex: number,
  texture: MdlTexture,
): MeshGeometry {
  const view = new DataView(model.buffer);
  const bytes = new Uint8Array(model.buffer);
  const triangles = expandTriangles(view, triIndex);

  const count = triangles.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const boneIndices = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const corner = triangles[i];

    // Bone assignment lives in a parallel byte array, one entry per vertex.
    boneIndices[i] = bytes[subModel.vertInfoIndex + corner.vertex];

    const v = subModel.vertIndex + corner.vertex * 12;
    positions[i * 3] = view.getFloat32(v, true);
    positions[i * 3 + 1] = view.getFloat32(v + 4, true);
    positions[i * 3 + 2] = view.getFloat32(v + 8, true);

    const n = subModel.normIndex + corner.normal * 12;
    normals[i * 3] = view.getFloat32(n, true);
    normals[i * 3 + 1] = view.getFloat32(n + 4, true);
    normals[i * 3 + 2] = view.getFloat32(n + 8, true);

    uvs[i * 2] = corner.s / texture.width;
    uvs[i * 2 + 1] = corner.t / texture.height;
  }

  return { texture, positions, normals, uvs, boneIndices, triangleCount: count / 3 };
}

/** Builds every mesh of the model, grouped by texture so each is one draw call. */
export function buildGeometry(model: MdlFile): ModelGeometry {
  const meshes: MeshGeometry[] = [];

  for (const bodyPart of model.bodyParts) {
    // Body parts can hold alternate sub-models; the shipped knives use one each.
    const subModel = bodyPart.models[0];
    if (!subModel) continue;

    for (const mesh of subModel.meshes) {
      if (mesh.numTris === 0) continue;
      meshes.push(buildMesh(model, subModel, mesh.triIndex, textureFor(model, mesh.skinRef)));
    }
  }

  return { meshes };
}

export interface PosedMesh {
  positions: Float32Array;
  normals: Float32Array;
}

/**
 * Poses one mesh into caller-owned buffers. The renderer calls this every
 * frame, so it must not allocate.
 */
export function poseInto(
  mesh: MeshGeometry,
  bones: Matrix3x4[],
  positions: Float32Array,
  normals: Float32Array,
): void {
  const count = mesh.boneIndices.length;

  for (let i = 0; i < count; i += 1) {
    const matrix = bones[mesh.boneIndices[i]];
    const o = i * 3;

    const p = transformPoint(matrix, mesh.positions[o], mesh.positions[o + 1], mesh.positions[o + 2]);
    const n = rotateVector(matrix, mesh.normals[o], mesh.normals[o + 1], mesh.normals[o + 2]);
    for (let axis = 0; axis < 3; axis += 1) {
      positions[o + axis] = p[axis];
      normals[o + axis] = n[axis];
    }
  }
}

/** Allocating wrapper around `poseInto`, for one-off use. */
export function applyPose(mesh: MeshGeometry, bones: Matrix3x4[]): PosedMesh {
  const positions = new Float32Array(mesh.boneIndices.length * 3);
  const normals = new Float32Array(mesh.boneIndices.length * 3);
  poseInto(mesh, bones, positions, normals);
  return { positions, normals };
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function boundsOf(posed: PosedMesh[]): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const mesh of posed) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = mesh.positions[i + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }

  return { min, max };
}
