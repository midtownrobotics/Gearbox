// `pnpm --filter @g3/pit-log-downloader smoke`: starts the downloader with no robot, no Drive and
// an empty data folder, waits for its status page to answer, and stops it. CI runs it on Linux,
// Windows and macOS.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "pit-log-downloader-"));
const port = 3917;
const child = spawn(process.execPath, [join(import.meta.dirname, "../src/index.ts")], {
  env: { ...process.env, TEAM_NUMBER: "1648", DATA_DIR: dataDir, PORT: String(port) },
  stdio: "inherit",
});

let failure: string | null = "the status page didn't answer within 20 seconds";
for (let i = 0; i < 40 && child.exitCode === null; i++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const status = await fetch(`http://127.0.0.1:${port}/status`)
    .then(
      (r) => r.json() as Promise<{ constants?: { kRioIp?: string }; counts?: { total?: number } }>,
    )
    .catch(() => null);
  if (!status) continue;
  failure =
    status.constants?.kRioIp === "10.16.48.2" && status.counts?.total === 0
      ? null
      : `unexpected status: ${JSON.stringify(status.constants)}`;
  break;
}
if (child.exitCode !== null) failure = `it exited with code ${child.exitCode}`;

child.kill();
rmSync(dataDir, { recursive: true, force: true });
if (failure) {
  console.error(`Smoke test failed: ${failure}.`);
  process.exit(1);
}
console.log("Smoke test passed: the downloader started and its status page answered.");
