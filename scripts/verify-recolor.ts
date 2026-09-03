/**
 * Runs the real recoloring engine over every shipped knife and asserts the
 * invariant the whole approach rests on: nothing outside the palettes moves.
 *
 *   npx esbuild scripts/verify-recolor.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.tmp/verify.mjs && node node_modules/.tmp/verify.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { KNIVES } from "../src/data/knives";
import { PRESETS, toStops } from "../src/data/presets";
import { knifeTextures, parseMdl, soundEvents } from "../src/mdl/parse";
import { buildRecoloredFile, measureBrightness, recolorTextures } from "../src/mdl/recolor";
import { paletteOffset, readPalette, readPixels } from "../src/mdl/texture";

const MODELS = join(process.cwd(), "public", "models");
const preset = PRESETS.find((candidate) => candidate.id === "doppler")!;
const stops = toStops(preset.colors);

let failures = 0;
const fail = (message: string) => {
  console.error(`  FAIL ${message}`);
  failures += 1;
};

console.log(`preset: ${preset.name}\n`);
console.log("knife".padEnd(18), "band".padEnd(13), "changed".padEnd(9), "outside palette");

for (const knife of KNIVES) {
  const source = readFileSync(join(MODELS, `${knife.slug}.mdl`));
  const buffer = source.buffer.slice(
    source.byteOffset,
    source.byteOffset + source.byteLength,
  ) as ArrayBuffer;

  const model = parseMdl(buffer);
  const targets = knifeTextures(model);
  if (targets.length === 0) fail(`${knife.slug}: no knife texture found`);

  const recolored = recolorTextures(model, targets, stops);
  const out = buildRecoloredFile(model, recolored);

  if (out.byteLength !== source.byteLength) {
    fail(`${knife.slug}: size changed ${source.byteLength} -> ${out.byteLength}`);
  }

  // Every differing byte must fall inside a palette we deliberately rewrote.
  const zones = recolored.map(({ texture }) => {
    const start = paletteOffset(texture);
    return { start, end: start + 768 };
  });
  let changed = 0;
  let outside = 0;
  for (let i = 0; i < source.byteLength; i += 1) {
    if (source[i] === out[i]) continue;
    changed += 1;
    if (!zones.some((zone) => i >= zone.start && i < zone.end)) outside += 1;
  }
  if (outside > 0) fail(`${knife.slug}: ${outside} bytes changed outside the palettes`);

  // The result must still parse as a valid studio model.
  try {
    const reparsed = parseMdl(out.buffer.slice(0) as ArrayBuffer);
    if (reparsed.header.numBones !== model.header.numBones) {
      fail(`${knife.slug}: bone count changed after recoloring`);
    }
    if (soundEvents(reparsed).length !== soundEvents(model).length) {
      fail(`${knife.slug}: sound events changed after recoloring`);
    }
  } catch (cause) {
    fail(`${knife.slug}: output no longer parses — ${(cause as Error).message}`);
  }

  const first = targets[0];
  const band = measureBrightness(readPalette(model, first), readPixels(model, first));

  console.log(
    knife.slug.padEnd(18),
    `${band.low.toFixed(2)} - ${band.high.toFixed(2)}`.padEnd(13),
    String(changed).padEnd(9),
    String(outside),
  );

  if (knife.slug === "karambit-knife") {
    writeFileSync(join(process.cwd(), "node_modules", ".tmp", "karambit-doppler-ts.mdl"), out);
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
