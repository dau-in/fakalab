/**
 * Reader for GoldSrc studio models (`.mdl`, magic `IDST`, version 10).
 *
 * The format is one flat binary blob: almost every sub-structure is reached
 * through an absolute byte offset from the start of the file, stored as a
 * plain int32 in a parent struct. A `numX` / `Xindex` pair means "read numX
 * fixed-size records starting at byte Xindex".
 *
 * Struct layouts follow Valve's own engine/studio.h.
 */

export const MDL_MAGIC = 0x54534449; // "IDST" little-endian
export const MDL_VERSION = 10;

const SIZEOF_BONE = 112;
const SIZEOF_TEXTURE = 80;
const SIZEOF_BODYPART = 76;
const SIZEOF_MODEL = 112;
const SIZEOF_MESH = 20;
const SIZEOF_SEQDESC = 176;
const SIZEOF_EVENT = 76;

/** Palette entries are RGB triplets; a full palette is always 256 of them. */
export const PALETTE_BYTES = 768;

export interface MdlHeader {
  name: string;
  /** Total file size. Must stay in sync with the real byte length. */
  length: number;
  numBones: number;
  boneIndex: number;
  numSeq: number;
  seqIndex: number;
  numSeqGroups: number;
  numTextures: number;
  textureIndex: number;
  numSkinRef: number;
  numSkinFamilies: number;
  skinIndex: number;
  numBodyParts: number;
  bodyPartIndex: number;
}

export interface MdlBone {
  name: string;
  /** Index into the bone array, or -1 for a root bone. */
  parent: number;
  /** Bind pose: position xyz followed by rotation xyz, in radians. */
  value: number[];
  scale: number[];
}

export interface MdlTexture {
  name: string;
  flags: number;
  width: number;
  height: number;
  /** Offset of the pixel block; the 768-byte palette follows it immediately. */
  index: number;
}

export interface MdlMesh {
  numTris: number;
  triIndex: number;
  /** Indexes the skin table, not the texture array directly. */
  skinRef: number;
}

export interface MdlSubModel {
  name: string;
  numVerts: number;
  vertIndex: number;
  vertInfoIndex: number;
  numNorms: number;
  normIndex: number;
  normInfoIndex: number;
  meshes: MdlMesh[];
}

export interface MdlBodyPart {
  name: string;
  base: number;
  models: MdlSubModel[];
}

export interface MdlEvent {
  frame: number;
  /** Event 5004 means "play this sound"; options holds the path. */
  event: number;
  options: string;
}

export interface MdlSequence {
  label: string;
  fps: number;
  numFrames: number;
  numBlends: number;
  animIndex: number;
  seqGroup: number;
  events: MdlEvent[];
}

export interface MdlFile {
  header: MdlHeader;
  bones: MdlBone[];
  textures: MdlTexture[];
  /** numSkinFamilies * numSkinRef entries; family 0 starts at 0. */
  skinTable: Int16Array;
  bodyParts: MdlBodyPart[];
  sequences: MdlSequence[];
  /** The untouched source bytes. Recoloring patches this in place. */
  buffer: ArrayBuffer;
}

export class MdlParseError extends Error {}

const ascii = new TextDecoder("ascii");

/** Reads a fixed-width, NUL-padded ASCII field. */
function readName(bytes: Uint8Array, offset: number, size: number): string {
  let end = offset;
  const limit = offset + size;
  while (end < limit && bytes[end] !== 0) end += 1;
  return ascii.decode(bytes.subarray(offset, end));
}

export function parseMdl(buffer: ArrayBuffer): MdlFile {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  if (buffer.byteLength < 244) {
    throw new MdlParseError("File is too small to be a studio model.");
  }
  if (view.getUint32(0, true) !== MDL_MAGIC) {
    throw new MdlParseError("Not a GoldSrc studio model (missing IDST magic).");
  }
  const version = view.getInt32(4, true);
  if (version !== MDL_VERSION) {
    throw new MdlParseError(
      `Unsupported studio model version ${version}, expected ${MDL_VERSION}.`,
    );
  }

  // 26 consecutive int32 counts and offsets begin right after the bounding boxes.
  const at = (i: number) => view.getInt32(140 + i * 4, true);

  const header: MdlHeader = {
    name: readName(bytes, 8, 64),
    length: view.getInt32(72, true),
    numBones: at(0),
    boneIndex: at(1),
    numSeq: at(6),
    seqIndex: at(7),
    numSeqGroups: at(8),
    numTextures: at(10),
    textureIndex: at(11),
    numSkinRef: at(13),
    numSkinFamilies: at(14),
    skinIndex: at(15),
    numBodyParts: at(16),
    bodyPartIndex: at(17),
  };

  if (header.length !== buffer.byteLength) {
    throw new MdlParseError(
      `Header declares ${header.length} bytes but the file is ${buffer.byteLength}.`,
    );
  }
  if (header.numTextures === 0) {
    throw new MdlParseError("Model has no embedded textures (it needs a separate T.mdl).");
  }

  const bones: MdlBone[] = [];
  for (let i = 0; i < header.numBones; i += 1) {
    const o = header.boneIndex + i * SIZEOF_BONE;
    const value: number[] = [];
    const scale: number[] = [];
    for (let k = 0; k < 6; k += 1) {
      value.push(view.getFloat32(o + 64 + k * 4, true));
      scale.push(view.getFloat32(o + 88 + k * 4, true));
    }
    bones.push({
      name: readName(bytes, o, 32),
      parent: view.getInt32(o + 32, true),
      value,
      scale,
    });
  }

  const textures: MdlTexture[] = [];
  for (let i = 0; i < header.numTextures; i += 1) {
    const o = header.textureIndex + i * SIZEOF_TEXTURE;
    const texture: MdlTexture = {
      name: readName(bytes, o, 64),
      flags: view.getInt32(o + 64, true),
      width: view.getInt32(o + 68, true),
      height: view.getInt32(o + 72, true),
      index: view.getInt32(o + 76, true),
    };
    const end = texture.index + texture.width * texture.height + PALETTE_BYTES;
    if (texture.index < 0 || end > buffer.byteLength) {
      throw new MdlParseError(`Texture "${texture.name}" points outside the file.`);
    }
    textures.push(texture);
  }

  const skinTable = new Int16Array(header.numSkinRef * header.numSkinFamilies);
  for (let i = 0; i < skinTable.length; i += 1) {
    skinTable[i] = view.getInt16(header.skinIndex + i * 2, true);
  }

  const bodyParts: MdlBodyPart[] = [];
  for (let i = 0; i < header.numBodyParts; i += 1) {
    const o = header.bodyPartIndex + i * SIZEOF_BODYPART;
    const numModels = view.getInt32(o + 64, true);
    const modelIndex = view.getInt32(o + 72, true);

    const models: MdlSubModel[] = [];
    for (let m = 0; m < numModels; m += 1) {
      const mo = modelIndex + m * SIZEOF_MODEL;
      const numMesh = view.getInt32(mo + 72, true);
      const meshIndex = view.getInt32(mo + 76, true);

      const meshes: MdlMesh[] = [];
      for (let k = 0; k < numMesh; k += 1) {
        const eo = meshIndex + k * SIZEOF_MESH;
        meshes.push({
          numTris: view.getInt32(eo, true),
          triIndex: view.getInt32(eo + 4, true),
          skinRef: view.getInt32(eo + 8, true),
        });
      }

      models.push({
        name: readName(bytes, mo, 64),
        numVerts: view.getInt32(mo + 80, true),
        vertInfoIndex: view.getInt32(mo + 84, true),
        vertIndex: view.getInt32(mo + 88, true),
        numNorms: view.getInt32(mo + 92, true),
        normInfoIndex: view.getInt32(mo + 96, true),
        normIndex: view.getInt32(mo + 100, true),
        meshes,
      });
    }

    bodyParts.push({
      name: readName(bytes, o, 64),
      base: view.getInt32(o + 68, true),
      models,
    });
  }

  const sequences: MdlSequence[] = [];
  for (let i = 0; i < header.numSeq; i += 1) {
    const o = header.seqIndex + i * SIZEOF_SEQDESC;
    const numEvents = view.getInt32(o + 48, true);
    const eventIndex = view.getInt32(o + 52, true);

    const events: MdlEvent[] = [];
    for (let e = 0; e < numEvents; e += 1) {
      const eo = eventIndex + e * SIZEOF_EVENT;
      events.push({
        frame: view.getInt32(eo, true),
        event: view.getInt32(eo + 4, true),
        options: readName(bytes, eo + 12, 64),
      });
    }

    sequences.push({
      label: readName(bytes, o, 32),
      fps: view.getFloat32(o + 32, true),
      numFrames: view.getInt32(o + 56, true),
      numBlends: view.getInt32(o + 120, true),
      animIndex: view.getInt32(o + 124, true),
      seqGroup: view.getInt32(o + 156, true),
      events,
    });
  }

  return { header, bones, textures, skinTable, bodyParts, sequences, buffer };
}

/** Texture names shared by every knife in the library: the player's hands. */
const HAND_TEXTURES = new Set(["view_glove.bmp", "view_finger.bmp", "view_skin.bmp"]);

export function isHandTexture(texture: MdlTexture): boolean {
  return HAND_TEXTURES.has(texture.name.toLowerCase());
}

/**
 * The textures that make up the knife itself. Hand textures are excluded:
 * they are the player's gloves and skin, not the weapon.
 */
export function knifeTextures(model: MdlFile): MdlTexture[] {
  return model.textures.filter((texture) => !isHandTexture(texture));
}

/** Sound files the model asks the engine to play, taken from its animation events. */
export function soundEvents(model: MdlFile): string[] {
  const paths = new Set<string>();
  for (const sequence of model.sequences) {
    for (const event of sequence.events) {
      if (event.event === 5004 && event.options) {
        paths.add(event.options.replace(/\\/g, "/"));
      }
    }
  }
  return [...paths].sort();
}
