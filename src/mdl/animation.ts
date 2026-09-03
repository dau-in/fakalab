/**
 * Animation decoding, ported from Valve's StudioCalcBonePosition and
 * StudioCalcBoneQuaternion.
 *
 * Each sequence stores six channels per bone (position xyz, rotation xyz) as
 * run-length compressed int16 deltas. A channel is a chain of spans; a span
 * header is two bytes, `valid` then `total`, followed by `valid` int16 values.
 * `total` counts the frames the span covers, so a run of identical frames
 * costs one value instead of many. Values are scaled by the bone's own scale
 * and added to its bind-pose value.
 *
 * The knives in this library all use a single sequence group with the data
 * embedded in the file, so no external sequence file is ever needed.
 */

import { angleQuaternion, concatTransforms, quaternionMatrix, type Matrix3x4 } from "./bones";
import type { MdlFile, MdlSequence } from "./parse";

/** Six uint16 channel offsets per bone, relative to the bone's own record. */
const SIZEOF_ANIM = 12;

/**
 * Reads one channel at one frame. Returns the raw delta; the caller scales it.
 * A zero offset means the channel never animates and stays at its bind value.
 */
function channelValue(
  view: DataView,
  animOffset: number,
  channel: number,
  frame: number,
): number {
  const offset = view.getUint16(animOffset + channel * 2, true);
  if (offset === 0) return 0;

  let span = animOffset + offset;
  let remaining = frame;

  // Walk spans until the one covering this frame.
  for (;;) {
    const valid = view.getUint8(span);
    const total = view.getUint8(span + 1);
    if (total === 0) return 0; // malformed rather than infinite
    if (total > remaining) {
      // Frames past the last stored value hold on that value.
      const index = valid > remaining ? remaining : valid - 1;
      return view.getInt16(span + 2 + index * 2, true);
    }
    remaining -= total;
    span += 2 + valid * 2;
  }
}

/**
 * Builds one world-space transform per bone for a given sequence and frame.
 * With no sequence the bind pose is returned, which is the modeling pose and
 * generally does not have the weapon in the player's hand.
 */
export function setupBones(model: MdlFile, sequence: MdlSequence, frame: number): Matrix3x4[] {
  const view = new DataView(model.buffer);
  const clamped =
    sequence.numFrames <= 1 ? 0 : ((frame % sequence.numFrames) + sequence.numFrames) % sequence.numFrames;

  const transforms: Matrix3x4[] = [];

  for (let i = 0; i < model.bones.length; i += 1) {
    const bone = model.bones[i];
    const animOffset = sequence.animIndex + i * SIZEOF_ANIM;

    const position: number[] = [];
    const rotation: number[] = [];
    for (let axis = 0; axis < 3; axis += 1) {
      position.push(
        bone.value[axis] + channelValue(view, animOffset, axis, clamped) * bone.scale[axis],
      );
      rotation.push(
        bone.value[axis + 3] +
          channelValue(view, animOffset, axis + 3, clamped) * bone.scale[axis + 3],
      );
    }

    const local = quaternionMatrix(angleQuaternion(rotation[0], rotation[1], rotation[2]));
    local[3] = position[0];
    local[7] = position[1];
    local[11] = position[2];

    transforms.push(
      bone.parent >= 0 && bone.parent < transforms.length
        ? concatTransforms(transforms[bone.parent], local)
        : local,
    );
  }

  return transforms;
}

/** The sequence a preview should idle on: the inspect loop these mods bake in. */
export function idleSequence(model: MdlFile): MdlSequence | null {
  if (model.sequences.length === 0) return null;
  const named = model.sequences.find((sequence) => /idle|lookat/i.test(sequence.label));
  return named ?? model.sequences[0];
}
