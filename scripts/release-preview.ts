// `pnpm release:preview [--github-output <file> --body-file <file>]`: what merging staging into public would release,
// without changing anything. Runs the release (release-version.ts) in a throwaway git worktree of
// HEAD and reports the result: the platform version, the apps that change and their notes. The
// release-PR workflow uses it to title and describe the open staging → public PR.

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
const intro = [
  "Merging this releases staging: the versions below are applied to `public` (package.json files,",
  "changelogs, RELEASES.md), tagged, and merged back into staging. This PR stays open and is",
  "updated after every push to staging.",
  "",
].join("\n");
const outro = [
  "",
  "_The platform version is worked out from today's date, so it can differ if this is merged in a later month._",
].join("\n");
const entry =
  summary.entry ??
  "No changesets are waiting, so merging would bring public up to date with staging without changing any version.";

// GitHub refuses a PR body over 65,536 characters: cut a long entry at a line and say so.
const MAX_BODY = 60_000;
const cutNote =
  "\n\n_…and more: the full notes are too long for a PR. Run `pnpm release:preview` to see them all._";
let notes = entry;
if (intro.length + notes.length + outro.length > MAX_BODY) {
  const room = MAX_BODY - intro.length - outro.length - cutNote.length;
  const cut = notes.lastIndexOf("\n", room);
  notes = notes.slice(0, cut > 0 ? cut : room) + cutNote;
}
const body = `${intro}\n${notes}\n${outro}`;

const out = process.argv.indexOf("--github-output");
const bodyFile = process.argv.indexOf("--body-file");
if (out !== -1) {
  // The body goes in a file: as an output it would reach `gh` through an environment variable,
  // and a long one is more than the runner can start a process with.
  appendFileSync(process.argv[out + 1], `title=${title}\n`);
  if (bodyFile === -1) throw new Error("--github-output needs --body-file");
  writeFileSync(process.argv[bodyFile + 1], body);
} else {
  console.log(`${title}\n\n${body}`);
}
