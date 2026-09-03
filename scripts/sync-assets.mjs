/**
 * Copies the shipped knife models out of models-source/ into public/ so Vite
 * can serve them. Keeps the ~11 MB of binaries out of the built source tree
 * and out of a second place in Git.
 */
import { mkdir, readdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "models-source", "csgo-knives-pack", "models");
const target = join(root, "public", "models");

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

console.log(`sync-assets: ${copied} models, ${(bytes / 1048576).toFixed(1)} MB`);
