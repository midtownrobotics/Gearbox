// `pnpm release:version`: turns the pending changesets into a release. The release bot runs it to
// build the "Release" PR (you can run it locally too):
//   1. `changeset version` bumps each changed app (page + worker together) and writes its
//      CHANGELOG.md;
//   2. the platform version (root package.json) moves to the next CalVer: YYYY.M.N, N counting
//      releases within the month;
//   3. RELEASES.md gets the release: every app's version, changed ones marked, and each changed
//      app's notes (the changeset summaries).

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const changeset = join(root, "node_modules/.bin/changeset");

/** Each app's name and the package.json that holds its version (page and worker share it). */
export const APPS: [name: string, packageJson: string][] = [
  ["G3ID", "workers/g3id/package.json"],
  ["Gearbox", "apps/portal/package.json"],
  ["Shop", "workers/shop/package.json"],
  ["Pit", "workers/pit/package.json"],
  ["Orders", "workers/orders/package.json"],
  ["Edge", "workers/edge/package.json"],
  ["Edge agent", "devices/edge-agent/package.json"],
  ["Scouting", "workers/scouting/package.json"],
  ["Skill Tree", "workers/skill-tree/package.json"],
  ["Attendance", "workers/attendance/package.json"],
];

const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

/** Which app a package belongs to: an app's page and worker both count as the app. */
function appOfPackage(name: string): string | undefined {
  for (const [app, path] of APPS) {
    const worker = readJson(path).name as string;
    if (name === worker || name === worker.replace("/worker-", "/")) return app;
  }
  return undefined;
}

/** The pending changesets' summaries by app (read before `changeset version` deletes them). */
function pendingNotes(): Map<string, string[]> {
  const notes = new Map<string, string[]>();
  const dir = join(root, ".changeset");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md")) {
    const [, front = "", body = ""] =
      readFileSync(join(dir, file), "utf8").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
    const apps = new Set(
      [...front.matchAll(/^"?([^":]+)"?\s*:/gm)].map((m) => appOfPackage(m[1].trim())),
    );
    for (const app of apps) {
      if (app && body.trim()) notes.set(app, [...(notes.get(app) ?? []), body.trim()]);
    }
  }
  return notes;
}
const appVersions = () =>
  new Map(APPS.map(([name, path]) => [name, readJson(path).version as string]));

/** The next CalVer after `current` (YYYY.M.N), for a release today. */
export function nextPlatformVersion(current: string, today = new Date()): string {
  const [year, month] = [today.getUTCFullYear(), today.getUTCMonth() + 1];
  const [y, m, n] = current.split(".").map(Number);
  return y === year && m === month ? `${year}.${month}.${n + 1}` : `${year}.${month}.0`;
}

if (import.meta.main) {
  const before = appVersions();
  const notes = pendingNotes();
  execFileSync(changeset, ["version"], { cwd: root, stdio: "inherit" });
  const after = appVersions();
  const changed = APPS.map(([name]) => name).filter((name) => before.get(name) !== after.get(name));
  if (changed.length === 0) {
    console.log("No app changed, so no platform release.");
    process.exit(0);
  }

  const rootPackage = readJson("package.json");
  rootPackage.version = nextPlatformVersion(rootPackage.version);
  writeFileSync(join(root, "package.json"), `${JSON.stringify(rootPackage, null, 2)}\n`);

  const date = new Date().toISOString().slice(0, 10);
  const rows = APPS.map(([name]) =>
    changed.includes(name)
      ? `| **${name}** | **${after.get(name)}** (was ${before.get(name)}) |`
      : `| ${name} | ${after.get(name)} |`,
  );
  const changes = changed.flatMap((name) => [
    `### ${name} ${after.get(name)}`,
    "",
    ...(notes.get(name) ?? ["Updated (no notes)."]).map((note) => `- ${note.replace(/\n+/g, " ")}`),
    "",
  ]);
  const entry = [
    `## ${rootPackage.version} (${date})`,
    "",
    "| App | Version |",
    "| --- | --- |",
    ...rows,
    "",
    ...changes,
  ].join("\n");

  const releasesPath = join(root, "RELEASES.md");
  const releases = readFileSync(releasesPath, "utf8");
  const marker = "<!-- releases -->\n";
  writeFileSync(releasesPath, releases.replace(marker, `${marker}\n${entry}`));
  console.log(`Platform ${rootPackage.version}: ${changed.join(", ")}`);
}
