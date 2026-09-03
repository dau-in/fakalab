import { readFileSync } from "node:fs";
import { join } from "node:path";

import { setupBindPose } from "../src/mdl/bones";
import { idleSequence, setupBones } from "../src/mdl/animation";
import { applyPose, boundsOf, buildGeometry } from "../src/mdl/geometry";
import { parseMdl } from "../src/mdl/parse";

const slug = process.argv[2] ?? "karambit-knife";
const file = readFileSync(join(process.cwd(), "public", "models", `${slug}.mdl`));
const model = parseMdl(
  file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
);
const geometry = buildGeometry(model);
const sequence = idleSequence(model)!;

const show = (label: string, bones: ReturnType<typeof setupBindPose>) => {
  console.log(`\n--- ${label} ---`);
  geometry.meshes.forEach((mesh, i) => {
    const { min, max } = boundsOf([applyPose(mesh, bones)]);
    const used = new Set(Array.from(mesh.boneIndices));
    console.log(
      `  mesh ${i} ${mesh.texture.name.padEnd(18)}`,
      `min ${min.map((n) => n.toFixed(1).padStart(7)).join(" ")}`,
      `max ${max.map((n) => n.toFixed(1).padStart(7)).join(" ")}`,
      `bones ${[...used].sort((a, b) => a - b).join(",")}`,
    );
  });
  for (const name of ["v_weapon", "v_weapon.knife", "v_weapon.Bip01_R_Hand"]) {
    const index = model.bones.findIndex((bone) => bone.name === name);
    if (index < 0) continue;
    const m = bones[index];
    console.log(`  ${name.padEnd(24)} at ${[m[3], m[7], m[11]].map((n) => n.toFixed(2)).join(", ")}`);
  }
};

show("bind pose", setupBindPose(model.bones));
for (const frame of [0, 30, 70]) show(`${sequence.label} frame ${frame}`, setupBones(model, sequence, frame));
