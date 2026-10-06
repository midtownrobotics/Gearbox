// `pnpm release:version`: turns the pending changesets into a release. The release workflow runs
// it on `public` after main is merged in (and release-preview.ts runs it in a scratch copy to name
// the release PR):
//   1. `changeset version` bumps each changed app (page + worker together) and writes its
//      CHANGELOG.md;
//   2. the platform version (root package.json) moves to the next CalVer: YYYY.M.N, N counting
//      releases within the month;
//   3. RELEASES.md gets the release: every app's version, changed ones marked, and each changed
//      app's notes (the changeset summaries).
// `--summary <file>` also writes what it did as JSON.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Each app's name and the package.json that holds its version (page and worker share it). */
export const APPS: [name: string, packageJson: string][] = [
  ["G3ID", "workers/g3id/package.json"],
  ["Portal", "workers/portal/package.json"],
  ["Platform", "workers/platform/package.json"],
  ["Shop", "workers/shop/package.json"],
  ["Pit", "workers/pit/package.json"],
  ["Orders", "workers/orders/package.json"],
  ["Edge", "workers/edge/package.json"],
  ["Edge agent", "devices/edge-agent/package.json"],
  ["Scouting", "workers/scouting/package.json"],
  ["Skill Tree", "workers/skill-tree/package.json"],
  ["Attendance", "workers/attendance/package.json"],
];

export type ReleaseSummary = {
  /** The new platform version, or null when no app changed. */
  platform: string | null;
  apps: { name: string; from: string; to: string; notes: string[] }[];
  /** The RELEASES.md entry, or null when no app changed. */
  entry: string | null;
};

/** The next CalVer after `current` (YYYY.M.N), for a release today. */
export function nextPlatformVersion(current: string, today = new Date()): string {
  const [year, month] = [today.getUTCFullYear(), today.getUTCMonth() + 1];
  const [y, m, n] = current.split(".").map(Number);
  return y === year && m === month ? `${year}.${month}.${n + 1}` : `${year}.${month}.0`;
}

/** Applies the pending changesets in the repo at `root` and returns what changed. */
export function applyRelease(root: string): ReleaseSummary {
  const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));
  const appVersions = () =>
    new Map(APPS.map(([name, path]) => [name, readJson(path).version as string]));

  /** Which app a package belongs to: an app's page and worker both count as the app. */
  const appOfPackage = (name: string) =>
    APPS.find(([, path]) => {
      const worker = readJson(path).name as string;
      return name === worker || name === worker.replace("/worker-", "/");
    })?.[0];

  // The changesets' summaries by app, read before `changeset version` deletes them.
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

  const before = appVersions();
  execFileSync(join(root, "node_modules/.bin/changeset"), ["version"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const after = appVersions();
  const changed = APPS.map(([name]) => name).filter((name) => before.get(name) !== after.get(name));
  const apps = changed.map((name) => ({
    name,
    from: before.get(name) as string,
    to: after.get(name) as string,
    notes: notes.get(name) ?? [],
  }));
  if (changed.length === 0) return { platform: null, apps, entry: null };

  const rootPackage = readJson("package.json");
  rootPackage.version = nextPlatformVersion(rootPackage.version);
  writeFileSync(join(root, "package.json"), `${JSON.stringify(rootPackage, null, 2)}\n`);

  const date = new Date().toISOString().slice(0, 10);
  const entry = [
    `## ${rootPackage.version} (${date})`,
    "",
    "| App | Version |",
    "| --- | --- |",
    ...APPS.map(([name]) =>
      changed.includes(name)
        ? `| **${name}** | **${after.get(name)}** (was ${before.get(name)}) |`
        : `| ${name} | ${after.get(name)} |`,
    ),
    "",
    ...apps.flatMap((app) => [
      `### ${app.name} ${app.to}`,
      "",
      ...(app.notes.length ? app.notes : ["Updated (no notes)."]).map(
        (note) => `- ${note.replace(/\n+/g, " ")}`,
      ),
      "",
    ]),
  ].join("\n");

  const releasesPath = join(root, "RELEASES.md");
  const marker = "<!-- releases -->\n";
  writeFileSync(
    releasesPath,
    readFileSync(releasesPath, "utf8").replace(marker, `${marker}\n${entry}`),
  );
  return { platform: rootPackage.version, apps, entry };
}

if (import.meta.main) {
  const summary = applyRelease(join(import.meta.dirname, ".."));
  const at = process.argv.indexOf("--summary");
  if (at !== -1) writeFileSync(process.argv[at + 1], JSON.stringify(summary, null, 2));
  console.log(
    summary.platform
      ? `Platform ${summary.platform}: ${summary.apps.map((a) => a.name).join(", ")}`
      : "No app changed, so no platform release.",
  );
}
