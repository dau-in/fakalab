/**
 * Checks that what the export hands the user is actually installable.
 *
 * The zip is the last thing between a working recolor and a broken game, and
 * everything about it is easy to get quietly wrong: a model that no longer
 * parses, a sound at a path the engine will not look in, a missing file. This
 * runs the real export for every knife and opens the result back up.
 *
 *   npx esbuild scripts/verify-export.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.tmp/verify-export.mjs
 *   node node_modules/.tmp/verify-export.mjs
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { unzipSync } from "fflate";

import { KNIVES } from "../src/data/knives";
import { PRESETS, toStops } from "../src/data/presets";
import { buildBundle } from "../src/export";
import { knifeTextures, parseMdl, soundEvents } from "../src/mdl/parse";
import { recolorTextures } from "../src/mdl/recolor";
import { loadModel } from "./lib/software-render";

const publicDir = join(process.cwd(), "public");
const preset = PRESETS.find((candidate) => candidate.id === "doppler")!;
const stops = toStops(preset.colors);

const loadSound = (path: string) =>
  readFile(join(publicDir, "sound", path)).then(
    (buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
  );

let failures = 0;
const fail = (message: string) => {
  console.error(`  FAIL ${message}`);
  failures += 1;
};

console.log(`preset: ${preset.name}\n`);
console.log("knife".padEnd(24) + "sounds".padStart(7) + "zip".padStart(10) + "  contents");

for (const knife of KNIVES) {
  const model = loadModel(join(publicDir, "models", `${knife.slug}.mdl`));
  const recolored = recolorTextures(model, knifeTextures(model), stops);
  const wanted = soundEvents(model);

  const bundle = await buildBundle({
    model,
    recolored,
    knifeName: knife.name,
    presetName: preset.name,
    loadSound,
  });

  if (!bundle.filename.endsWith(".zip")) fail(`${knife.slug}: expected a zip`);

  const files = unzipSync(new Uint8Array(await bundle.blob.arrayBuffer()));
  const names = Object.keys(files);

  // The model has to survive the round trip through the archive.
  const packed = files["models/v_knife.mdl"];
  if (!packed) {
    fail(`${knife.slug}: no models/v_knife.mdl in the zip`);
    continue;
  }
  try {
    const reparsed = parseMdl(
      packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer,
    );
    if (reparsed.header.numBones !== model.header.numBones) {
      fail(`${knife.slug}: bone count changed inside the zip`);
    }
  } catch (cause) {
    fail(`${knife.slug}: packed model does not parse - ${(cause as Error).message}`);
  }

  // Every sound the model asks for must sit at exactly the path it names,
  // because that string is what the engine looks up at runtime.
  for (const path of wanted) {
    if (!files[`sound/${path}`]) fail(`${knife.slug}: missing sound/${path}`);
  }

  if (!files["HOW TO INSTALL.txt"]) fail(`${knife.slug}: no instructions included`);

  const soundCount = names.filter((name) => name.startsWith("sound/")).length;
  console.log(
    knife.slug.padEnd(24) +
      String(soundCount).padStart(7) +
      `${(bundle.blob.size / 1024).toFixed(0)} KB`.padStart(10) +
      `  ${names.length} files`,
  );
}

// The no-sounds path should stay a single bare model file.
const plainModel = loadModel(join(publicDir, "models", "karambit-knife.mdl"));
const plain = await buildBundle({
  model: plainModel,
  recolored: recolorTextures(plainModel, knifeTextures(plainModel), stops),
  knifeName: "Karambit",
  presetName: preset.name,
});
if (plain.filename !== "v_knife.mdl") fail(`plain export named ${plain.filename}`);
if (plain.blob.size !== plainModel.header.length) {
  fail(`plain export is ${plain.blob.size} bytes, model is ${plainModel.header.length}`);
}
console.log(`\nwithout sounds: ${plain.filename}, ${plain.blob.size} bytes`);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
