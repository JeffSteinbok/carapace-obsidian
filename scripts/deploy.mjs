#!/usr/bin/env node
// Build the plugin and pack it into out/<plugin-id>.tgz for a managed
// OpenClaw install (`openclaw plugins install npm-pack:<tgz>`).
//
//   npm run deploy               build + pack, print the install command
//   npm run deploy -- --install  build + pack, then run the install command
//
// We use `npm pack` (honours package.json "files") rather than
// `openclaw plugins pack`: the latter only accepts plugins authored with
// OpenClaw's own tool/feature metadata and bundles everything into a single
// entry file, which Carapace plugins don't fit. The npm-pack: install
// installs production `dependencies` into OpenClaw's managed plugin root.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const install = process.argv.includes("--install");
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });

// 1. Build (also regenerates openclaw.plugin.json)
run("npm", ["run", "build"]);

// 2. Pack into out/<id>.tgz
const { id } = JSON.parse(readFileSync(resolve(root, "openclaw.plugin.json"), "utf8"));
const outDir = resolve(root, "out");
mkdirSync(outDir, { recursive: true });
const [packed] = JSON.parse(
  execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", outDir], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }),
);
const tgz = resolve(outDir, `${id.replaceAll("/", "__")}.tgz`);
rmSync(tgz, { force: true });
renameSync(resolve(outDir, packed.filename), tgz);

// 3. Guard against shipping dev files
const banned = packed.files
  .map((f) => f.path)
  .filter((p) => /^(node_modules|src|tests?|out)\//.test(p));
if (banned.length > 0) {
  console.error(`\nRefusing to deploy: pack contains dev files:\n  ${banned.join("\n  ")}`);
  console.error(`Fix "files" in package.json.`);
  process.exit(1);
}

console.log(`\nPacked ${packed.files.length} files (${(packed.size / 1024).toFixed(1)} kB) -> ${tgz}`);
for (const f of packed.files) console.log(`  ${f.path}`);

// 4. Install (or print how to)
const installArgs = ["plugins", "install", `npm-pack:${tgz}`, "--force"];
if (install) {
  console.log(`\n$ openclaw ${installArgs.join(" ")}`);
  run("openclaw", installArgs);
} else {
  console.log(`\nTo install:\n  openclaw ${installArgs.join(" ")}`);
}
