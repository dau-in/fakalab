/**
 * Builds what the user actually installs.
 *
 * Without sounds that is a single `v_knife.mdl`, which is the whole point of
 * the in-place recolor: one file, drag it in, done. With sounds it has to be a
 * zip, because the engine looks for them at the exact paths written inside the
 * model's own animation events, and those are nested folders.
 */

import { zipSync, type Zippable } from "fflate";

import { soundEvents, type MdlFile } from "./mdl/parse";
import { buildRecoloredFile, type RecoloredTexture } from "./mdl/recolor";

export interface BundleOptions {
  model: MdlFile;
  recolored: RecoloredTexture[];
  knifeName: string;
  presetName: string;
  /** Fetches a sound by the path stored in the model, e.g. "weapons/csgo/x.wav". */
  loadSound?: (path: string) => Promise<Uint8Array>;
}

export interface Bundle {
  blob: Blob;
  filename: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function instructions(knifeName: string, presetName: string, sounds: string[]): string {
  const soundLines = sounds.length
    ? [
        "  sound/          the sounds this knife plays",
        "",
      ]
    : [""];

  return [
    `FakaLab - ${knifeName}, ${presetName} finish`,
    "",
    "WHAT IS IN HERE",
    "",
    "  models/         your knife",
    ...soundLines,
    "HOW TO INSTALL",
    "",
    "  1. Find your Counter-Strike folder. It usually looks like:",
    "       ...\\Steam\\steamapps\\common\\Half-Life\\cstrike",
    "",
    "  2. Back up the knife you have now. Rename",
    "       cstrike\\models\\v_knife.mdl",
    "     to",
    "       cstrike\\models\\v_knife.mdl.backup",
    "",
    `  3. Copy the folder${sounds.length ? "s" : ""} from this zip into "cstrike"`,
    "     and let Windows merge them.",
    "",
    "  4. Start the game. That is it.",
    "",
    "TO UNDO",
    "",
    "  Delete cstrike\\models\\v_knife.mdl and rename your backup back.",
    "",
    "GOOD TO KNOW",
    "",
    "  Only the viewmodel changes, which is the knife in your own hands.",
    "  Everyone else still sees their own knife, not yours.",
    "",
    ...(sounds.length
      ? [
          "  The sounds install into their own folder and do not replace any",
          "  original Counter-Strike sound. You can skip them and the knife",
          "  still works, just silently.",
          "",
        ]
      : []),
    "  Made with FakaLab. The knife models are community work, not ours.",
    "",
  ].join("\r\n");
}

/**
 * Returns the file to hand the user. Sounds are included only when they were
 * asked for, the model declares some, and every one of them loads.
 */
export async function buildBundle(options: BundleOptions): Promise<Bundle> {
  const { model, recolored, knifeName, presetName, loadSound } = options;
  const bytes = buildRecoloredFile(model, recolored);
  const stem = `fakalab-${slugify(knifeName)}-${slugify(presetName)}`;

  if (!loadSound) {
    return {
      blob: new Blob([bytes], { type: "application/octet-stream" }),
      filename: "v_knife.mdl",
    };
  }

  const wanted = soundEvents(model);
  const entries: Zippable = { "models/v_knife.mdl": bytes };

  const loaded = await Promise.all(
    wanted.map(async (path) => {
      try {
        return { path, data: await loadSound(path) };
      } catch {
        // A missing sound is not fatal: the engine just stays quiet.
        return null;
      }
    }),
  );

  const included: string[] = [];
  for (const sound of loaded) {
    if (!sound) continue;
    entries[`sound/${sound.path}`] = sound.data;
    included.push(sound.path);
  }

  entries["HOW TO INSTALL.txt"] = new TextEncoder().encode(
    instructions(knifeName, presetName, included),
  );

  return {
    blob: new Blob([zipSync(entries, { level: 6 })], { type: "application/zip" }),
    filename: `${stem}.zip`,
  };
}
