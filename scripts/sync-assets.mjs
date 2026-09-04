/**
 * Copies the shipped knife models and their sounds out of models-source/ into
 * public/ so Vite can serve them. Keeps the binaries in one place in Git
 * rather than two.
 *
 * Sounds keep their folder structure, because the paths inside a model's
 * animation events are what the engine looks for at runtime, and the export
 * has to reproduce them exactly.
 */
import { mkdir, readdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pack = join(root, "models-source", "csgo-knives-pack");
const source = join(pack, "models");
const target = join(root, "public", "models");
const soundSource = join(pack, "sound");
const soundTarget = join(root, "public", "sound");

if (!existsSync(source)) {
  console.error(`sync-assets: missing ${source}`);
  process.exit(1);
}

await mkdir(target, { recursive: true });

const slugs = (await readdir(source, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let copied = 0;
let bytes = 0;
for (const slug of slugs) {
  const from = join(source, slug, "v_knife.mdl");
  if (!existsSync(from)) {
    console.warn(`sync-assets: ${slug} has no v_knife.mdl, skipping`);
    continue;
  }
  await copyFile(from, join(target, `${slug}.mdl`));
  bytes += (await stat(from)).size;
  copied += 1;
}

/** Mirrors a directory tree, preserving the paths the engine expects. */
async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  let files = 0;
  let size = 0;

  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const destination = join(to, entry.name);
    if (entry.isDirectory()) {
      const nested = await copyTree(source, destination);
      files += nested.files;
      size += nested.size;
    } else {
      await copyFile(source, destination);
      files += 1;
      size += (await stat(source)).size;
    }
  }
  return { files, size };
}

const sounds = existsSync(soundSource)
  ? await copyTree(soundSource, soundTarget)
  : { files: 0, size: 0 };

console.log(
  `sync-assets: ${copied} models (${(bytes / 1048576).toFixed(1)} MB), ` +
    `${sounds.files} sounds (${(sounds.size / 1048576).toFixed(1)} MB)`,
);
