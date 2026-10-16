// `pnpm --filter @g3/pit-log-downloader smoke`: starts the downloader with no settings, no robot,
// no Drive and an empty data folder (so not paired with Gearbox), waits for its status API and page to answer, and stops it. CI runs it on Linux,
// Windows and macOS.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Status } from "../src/status.ts";

const dataDir = mkdtempSync(join(tmpdir(), "pit-log-downloader-"));
const port = 3917;
const child = spawn(process.execPath, [join(import.meta.dirname, "../src/index.ts")], {
  env: { ...process.env, DATA_DIR: dataDir, PORT: String(port) },
  stdio: "inherit",
});

let failure: string | null = "the downloader didn't answer within 20 seconds";
for (let i = 0; i < 40 && child.exitCode === null; i++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const status = await fetch(`http://127.0.0.1:${port}/api/status`)
    .then((r) => r.json() as Promise<Partial<Status>>)
    .catch(() => null);
  if (!status) continue;
  const page = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
  failure =
    status.gearbox?.paired !== null || status.settings?.rioIp !== null || status.logs?.length !== 0
      ? `unexpected status: ${JSON.stringify(status.settings)}`
      : !page.includes('<div id="root">')
        ? "the status page isn't built"
        : null;
  break;
}
if (child.exitCode !== null) failure = `it exited with code ${child.exitCode}`;

child.kill();
rmSync(dataDir, { recursive: true, force: true });
if (failure) {
  console.error(`Smoke test failed: ${failure}.`);
  process.exit(1);
}
console.log("Smoke test passed: the downloader started and its status API and page answered.");
