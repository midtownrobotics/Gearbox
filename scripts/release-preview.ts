// `pnpm release:preview [--github-output <file>]`: what merging main into public would release,
// without changing anything. Runs the release (release-version.ts) in a throwaway git worktree of
// HEAD and reports the result: the platform version, the apps that change and their notes. The
// release-PR workflow uses it to title and describe the open main → public PR.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRelease } from "./release-version.ts";

const root = join(import.meta.dirname, "..");
const scratch = mkdtempSync(join(tmpdir(), "release-preview-"));
const worktree = join(scratch, "repo");

execFileSync("git", ["worktree", "add", "--detach", "--quiet", worktree, "HEAD"], { cwd: root });
let summary: ReturnType<typeof applyRelease>;
try {
  // The worktree is a fresh checkout: borrow this repo's installed packages.
  if (!existsSync(join(worktree, "node_modules"))) {
    symlinkSync(join(root, "node_modules"), join(worktree, "node_modules"));
  }
  summary = applyRelease(worktree);
} finally {
  execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: root });
  rmSync(scratch, { recursive: true, force: true });
}

const title = summary.platform
  ? `Release ${summary.platform}: ${summary.apps.map((a) => `${a.name} ${a.to}`).join(", ")}`
  : "Release: no app version changes yet";
const body = [
  "Merging this releases main: the versions below are applied to `public` (package.json files,",
  "changelogs, RELEASES.md), tagged, and merged back into main. This PR stays open and is",
  "updated after every push to main.",
  "",
  summary.entry ??
    "No changesets are waiting, so merging would bring public up to date with main without changing any version.",
  "",
  "_The platform version is worked out from today's date, so it can differ if this is merged in a later month._",
].join("\n");

const out = process.argv.indexOf("--github-output");
if (out !== -1) {
  // Multi-line values in GITHUB_OUTPUT use a heredoc-style delimiter.
  appendFileSync(process.argv[out + 1], `title=${title}\nbody<<__BODY__\n${body}\n__BODY__\n`);
} else {
  console.log(`${title}\n\n${body}`);
}
