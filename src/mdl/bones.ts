/**
 * Bone transforms, ported from Valve's cl_dll/studio_util.cpp.
 *
 * Matrices are 3x4 row-major: `m[row * 4 + col]`, with column 3 holding the
 * translation. That is the layout the engine itself uses, kept here so the
 * math stays line-for-line comparable with the original.
 */

export type Matrix3x4 = Float32Array;

export function identity3x4(): Matrix3x4 {
  const m = new Float32Array(12);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  return m;
}

/** Euler angles in radians (x, y, z) to a quaternion (x, y, z, w). */
export function angleQuaternion(x: number, y: number, z: number): [number, number, number, number] {
  const sy = Math.sin(z * 0.5);
  const cy = Math.cos(z * 0.5);
  const sp = Math.sin(y * 0.5);
  const cp = Math.cos(y * 0.5);
  const sr = Math.sin(x * 0.5);
  const cr = Math.cos(x * 0.5);

  return [
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy,
  ];
}

/** Quaternion to a rotation matrix; the translation column is left at zero. */
export function quaternionMatrix(q: [number, number, number, number], out = new Float32Array(12)) {
  const [x, y, z, w] = q;

  out[0] = 1 - 2 * y * y - 2 * z * z;
  out[4] = 2 * x * y + 2 * w * z;
  out[8] = 2 * x * z - 2 * w * y;

  out[1] = 2 * x * y - 2 * w * z;
  out[5] = 1 - 2 * x * x - 2 * z * z;
  out[9] = 2 * y * z + 2 * w * x;

  out[2] = 2 * x * z + 2 * w * y;
  out[6] = 2 * y * z - 2 * w * x;
  out[10] = 1 - 2 * x * x - 2 * y * y;

  return out;
}

/** out = a * b, for 3x4 transforms. */
export function concatTransforms(a: Matrix3x4, b: Matrix3x4, out = new Float32Array(12)) {
  for (let row = 0; row < 3; row += 1) {
    const r = row * 4;
    out[r] = a[r] * b[0] + a[r + 1] * b[4] + a[r + 2] * b[8];
    out[r + 1] = a[r] * b[1] + a[r + 1] * b[5] + a[r + 2] * b[9];
    out[r + 2] = a[r] * b[2] + a[r + 1] * b[6] + a[r + 2] * b[10];
    out[r + 3] = a[r] * b[3] + a[r + 1] * b[7] + a[r + 2] * b[11] + a[r + 3];
  }
  return out;
}

/** Applies a transform to a point, translation included. */
export function transformPoint(m: Matrix3x4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

/** Applies only the rotation, for normals. */
export function rotateVector(m: Matrix3x4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[4] * x + m[5] * y + m[6] * z,
    m[8] * x + m[9] * y + m[10] * z,
  ];
}

export interface BindPoseBone {
  parent: number;
  /** Position xyz then rotation xyz (radians), as stored in the file. */
  value: number[];
}

/**
 * Builds one world-space transform per bone from the bind pose stored in the
 * bone table. Bones always appear after their parent, so a single forward pass
 * is enough.
 */
export function setupBindPose(bones: BindPoseBone[]): Matrix3x4[] {
  const transforms: Matrix3x4[] = [];

  for (const bone of bones) {
    const local = quaternionMatrix(angleQuaternion(bone.value[3], bone.value[4], bone.value[5]));
    local[3] = bone.value[0];
    local[7] = bone.value[1];
    local[11] = bone.value[2];

    const parent = bone.parent;
    transforms.push(
      parent >= 0 && parent < transforms.length
        ? concatTransforms(transforms[parent], local)
        : local,
    );
  }

  return transforms;
}
