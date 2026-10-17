// Builds AdvantageScope Lite for Pit, which serves it at /scope/: the release in
// vendor/advantagescope (a git submodule of Mechanical-Advantage/AdvantageScope) with
// gearbox.patch, built as upstream builds its Lite distribution, into apps/pit/public/scope.
//
// Needs network (npm, and the field and robot assets from GitHub) and Emscripten 4.0.12 (`emcc`,
// for the WPILOG reader). Skips everything when public/scope is already built from the same
// release, patch and script. ADVANTAGESCOPE=skip leaves it out (Pit builds without /scope/).

import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const source = path.join(repo, "vendor/advantagescope");
const work = path.join(here, ".build");
const out = path.resolve(here, "../public/scope");
const patch = path.join(here, "gearbox.patch");
const stampFile = path.join(out, ".gearbox-build.json");
const EMSCRIPTEN = "4.0.12";
const EMSDK_DOCS = "https://emscripten.org/docs/getting_started/downloads.html";

const log = (message) => console.log(`[advantagescope] ${message}`);
const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
const run = (command, args, cwd, env = {}) =>
  execFileSync(command, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

// The release is the submodule's commit as the repository records it, so a cached build is
// recognized without checking the submodule out.
const commit = execFileSync("git", ["-C", repo, "ls-files", "-s", "vendor/advantagescope"])
  .toString()
  .split(/\s+/)[1];
if (!commit) throw new Error("vendor/advantagescope isn't a submodule here.");
const stamp = JSON.stringify({
  commit,
  patch: sha(patch),
  script: sha(fileURLToPath(import.meta.url)),
});

if (read(stampFile) === stamp) {
  log("already built");
  process.exit(0);
}
if (process.env.ADVANTAGESCOPE === "skip") {
  log("skipped (ADVANTAGESCOPE=skip): Pit builds without AdvantageScope at /scope/");
  process.exit(0);
}

try {
  const version = execFileSync("emcc", ["--version"]).toString();
  if (!version.includes(EMSCRIPTEN)) throw new Error();
} catch {
  console.error(
    `[advantagescope] Building AdvantageScope needs Emscripten ${EMSCRIPTEN} (emcc): see ${EMSDK_DOCS}. Or set ADVANTAGESCOPE=skip to build Pit without it.`,
  );
  process.exit(1);
}

if (!fs.existsSync(path.join(source, "package.json"))) {
  log("checking out vendor/advantagescope");
  run("git", ["submodule", "update", "--init", "--depth", "1", "vendor/advantagescope"], repo);
}

// A fresh copy of the release, keeping what's slow to fetch again (dependencies, downloaded assets).
const KEEP = ["node_modules", "docs/node_modules", "lite/static/bundledAssets"];
fs.mkdirSync(work, { recursive: true });
for (const keep of KEEP) {
  const from = path.join(work, keep);
  if (fs.existsSync(from))
    fs.renameSync(from, path.join(here, `.keep-${keep.replaceAll("/", "-")}`));
}
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
execSync(`git -C "${source}" archive --format=tar ${commit} | tar -x -C "${work}"`, {
  stdio: "inherit",
});
for (const keep of KEEP) {
  const kept = path.join(here, `.keep-${keep.replaceAll("/", "-")}`);
  if (fs.existsSync(kept)) fs.renameSync(kept, path.join(work, keep));
}
// A repository of its own: inside Gearbox's, git apply would skip every path silently.
log("applying gearbox.patch");
run("git", ["init", "-q"], work);
run("git", ["apply", "--whitespace=nowarn", patch], work);
if (!fs.existsSync(path.join(work, "src/main/lite/teamStorage.ts"))) {
  throw new Error("gearbox.patch didn't apply.");
}

// Dependencies, without their install scripts (Electron's download, docs, the desktop app's).
for (const dir of [work, path.join(work, "docs")]) {
  const lock = sha(path.join(dir, "package-lock.json"));
  const marker = path.join(dir, "node_modules", ".gearbox-lock");
  if (read(marker) !== lock) {
    log(`installing dependencies in ${path.relative(work, dir) || "."}`);
    run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], dir);
    fs.writeFileSync(marker, lock);
  }
}

const lite = { ASCOPE_DISTRIBUTION: "LITE" };
run("node", ["getLicenses.mjs"], work);
run("node", ["bundleLiteAssets.mjs"], work, lite);
run("npm", ["run", "compile"], work, lite);
run("node", ["wasmCompile.mjs"], work);
run("npm", ["run", "build-embed"], path.join(work, "docs"));

// The page, with its links (www, the docs) copied as files.
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(work, "lite/static"), out, { recursive: true, dereference: true });
fs.copyFileSync(path.join(work, "LICENSE"), path.join(out, "LICENSE"));

// The built-in assets' index, in the form AdvantageScope's Python server answers /assets: each
// file's path in its asset's folder, with config.json's contents (the patch reads it).
const assets = path.join(out, "bundledAssets");
const index = {};
for (const name of fs.readdirSync(assets)) {
  const folder = path.join(assets, name);
  if (name.startsWith(".") || !fs.statSync(folder).isDirectory()) continue;
  for (const file of fs.readdirSync(folder)) {
    if (file.startsWith(".")) continue;
    index[`${name}/${file}`] =
      file === "config.json" ? JSON.parse(fs.readFileSync(path.join(folder, file), "utf8")) : null;
  }
}
fs.writeFileSync(path.join(assets, "index.json"), JSON.stringify(index));

fs.writeFileSync(stampFile, stamp);
log(`built ${commit.slice(0, 7)} into apps/pit/public/scope`);
