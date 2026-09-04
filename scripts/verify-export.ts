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
import { MATERIALS } from "../src/data/materials";
import { ORIGINAL_FINISH } from "../src/mdl/finish";
import { buildBundle } from "../src/export";
import { knifeTextures, parseMdl, soundEvents } from "../src/mdl/parse";
import { applyFinishToPalette, applyFinishes, type FinishLook } from "../src/mdl/recolor";
import { REGION_BLADE, REGION_HANDLE } from "../src/mdl/regions";
import { readMaskFile } from "./lib/read-mask";
import { loadModel } from "./lib/software-render";

const publicDir = join(process.cwd(), "public");
const camo = MATERIALS.find((candidate) => candidate.id === "digital")!;
const carbon = MATERIALS.find((candidate) => candidate.id === "carbon")!;

const loadSound = (path: string) =>
  readFile(join(publicDir, "sound", path)).then(
    (buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
  );

let failures = 0;
const fail = (message: string) => {
  console.error(`  FAIL ${message}`);
  failures += 1;
};

console.log(`materials: ${camo.name} on the blade, ${carbon.name} on the grip`);
console.log("knife".padEnd(24) + "sounds".padStart(7) + "zip".padStart(10) + "  contents");

for (const knife of KNIVES) {
  const model = loadModel(join(publicDir, "models", `${knife.slug}.mdl`));
  const recolored = knifeTextures(model).map((texture) =>
    applyFinishes(model, texture, readMaskFile(join(publicDir, "regions", `${knife.slug}.png`)), {
      finishes: {
        [REGION_BLADE]: { ...camo.finish },
        [REGION_HANDLE]: { ...carbon.finish },
      },
    }),
  );
  const wanted = soundEvents(model);

  const bundle = await buildBundle({
    model,
    recolored,
    knifeName: knife.name,
    presetName: camo.name,
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
  recolored: knifeTextures(plainModel).map((texture) =>
    applyFinishToPalette(plainModel, texture, ORIGINAL_FINISH),
  ),
  knifeName: "Karambit",
  presetName: camo.name,
});
if (plain.filename !== "v_knife.mdl") fail(`plain export named ${plain.filename}`);
if (plain.blob.size !== plainModel.header.length) {
  fail(`plain export is ${plain.blob.size} bytes, model is ${plainModel.header.length}`);
}
console.log(`\nwithout sounds: ${plain.filename}, ${plain.blob.size} bytes`);

// The pixel path rewrites a quarter of a million indices as well as the palette.
// Both replace equal-length runs, so the file must not change size by a byte.
console.log("\npixel path: blade and handle coloured apart, with a pattern\n");
console.log("knife".padEnd(24) + "source".padStart(10) + "export".padStart(10) + "  parses");

for (const knife of KNIVES) {
  const model = loadModel(join(publicDir, "models", `${knife.slug}.mdl`));
  const mask = readMaskFile(join(publicDir, "regions", `${knife.slug}.png`));
  const look: FinishLook = {
    finishes: {
      [REGION_BLADE]: { ...camo.finish },
      [REGION_HANDLE]: { ...ORIGINAL_FINISH, mode: "tint", color: "#2b3a5c", strength: 0.8 },
    },
  };

  const recolored = knifeTextures(model).map((texture) =>
    applyFinishes(model, texture, mask, look),
  );
  const bundle = await buildBundle({
    model,
    recolored,
    knifeName: knife.name,
    presetName: camo.name,
  });

  const bytes = new Uint8Array(await bundle.blob.arrayBuffer());
  if (bytes.length !== model.header.length) {
    fail(`${knife.slug}: pixel path changed size, ${model.header.length} -> ${bytes.length}`);
  }

  let parses = "yes";
  try {
    const reparsed = parseMdl(bytes.buffer.slice(0) as ArrayBuffer);
    if (reparsed.header.numBones !== model.header.numBones) fail(`${knife.slug}: bones changed`);
    if (knifeTextures(reparsed).length !== knifeTextures(model).length) {
      fail(`${knife.slug}: texture count changed`);
    }
  } catch (cause) {
    parses = "NO";
    fail(`${knife.slug}: pixel-path output does not parse - ${(cause as Error).message}`);
  }

  console.log(
    knife.slug.padEnd(24) +
      String(model.header.length).padStart(10) +
      String(bytes.length).padStart(10) +
      `  ${parses}`,
  );
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
