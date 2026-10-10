// `pnpm release:tag [--push]`: tags a release once its versions are on main. The release bot runs
// it after the "Release" PR is merged. Tags the platform (v2026.10.1) and each app's new version
// (@g3/worker-orders@1.5.0, ...; `changeset tag` skips ones already tagged). Does nothing if the
// platform version is already tagged, so it's safe to run on every push.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const changeset = join(root, "node_modules/.bin/changeset");
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tag = `v${version}`;

if (git("tag", "--list", tag)) {
  console.log(`${tag} is already tagged; nothing to do.`);
  process.exit(0);
}

execFileSync(changeset, ["tag"], { cwd: root, stdio: "inherit" });
git("tag", "-a", tag, "-m", `Platform ${version}`);
console.log(`Tagged ${tag}.`);

if (process.argv.includes("--push")) {
  execFileSync("git", ["push", "origin", "--tags"], { cwd: root, stdio: "inherit" });
}
