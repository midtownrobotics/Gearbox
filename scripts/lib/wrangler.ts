// Running Wrangler from the repo's scripts (staging-create.ts, staging-copy-team.ts), the way it
// works on a dev machine. Two lessons from making staging:
// - Wrangler checks npm for a newer version of itself (on its banner, and again after an error).
//   On a slow link to npm that download (megabytes) keeps it from exiting for minutes after it's
//   done, so every call first says the check just ran (update-check's cache, under an hour old)
//   and hides the banner.
// - Run with its output captured and non-interactively, a deploy waited on Cloudflare and never
//   finished. So only answers that are read back (lists, queries) are captured; anything that
//   changes Cloudflare runs straight in the terminal, as if typed there.
// Needs a Wrangler login (`wrangler login`) or CLOUDFLARE_API_TOKEN, and CLOUDFLARE_ACCOUNT_ID if
// the login sees several accounts.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const root = join(import.meta.dirname, "../..");

/** Wrangler as a worker installs it. */
const WRANGLER = join(root, "workers/g3id/node_modules/.bin/wrangler");

const WRANGLER_VERSION = (
  JSON.parse(
    readFileSync(join(root, "workers/g3id/node_modules/wrangler/package.json"), "utf8"),
  ) as { version: string }
).version;

const TIMEOUT_MS = 120_000;

/** An empty folder, so no worker's wrangler.toml applies unless a call says which (`cwd`). */
export const scratch = mkdtempSync(join(tmpdir(), "gearbox-wrangler-"));

/** Says Wrangler's npm check just ran, so it doesn't download (see the top of the file). */
function skipUpdateCheck() {
  const dir = join(tmpdir(), "update-check");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "wrangler-latest.json"),
    JSON.stringify({ latest: WRANGLER_VERSION, lastUpdate: Date.now() }),
  );
}

const env = (interactive: boolean) => ({
  ...process.env,
  WRANGLER_HIDE_BANNER: "true",
  WRANGLER_SEND_METRICS: "false",
  ...(interactive ? {} : { CI: "1" }),
});

const timedOut = (args: string[], err: unknown) =>
  (err as { code?: string }).code === "ETIMEDOUT"
    ? new Error(`wrangler ${args.join(" ")} didn't finish in ${TIMEOUT_MS / 1000} s.`)
    : err;

/**
 * Runs Wrangler non-interactively and gives back what it printed (for answers read back: lists,
 * queries). Its messages reach the terminal, unless `quiet` (for an answer that may fail).
 */
export function wranglerOutput(
  args: string[],
  { quiet = false, cwd = scratch }: { quiet?: boolean; cwd?: string } = {},
): string {
  skipUpdateCheck();
  try {
    return execFileSync(WRANGLER, args, {
      cwd,
      encoding: "utf8",
      env: env(false),
      stdio: ["ignore", "pipe", quiet ? "pipe" : "inherit"],
      timeout: TIMEOUT_MS,
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch (err) {
    throw timedOut(args, err);
  }
}

/** Runs Wrangler straight in the terminal (for anything that changes Cloudflare). */
export function wranglerLive(
  args: string[],
  { cwd = scratch, timeoutMs = TIMEOUT_MS }: { cwd?: string; timeoutMs?: number } = {},
) {
  skipUpdateCheck();
  try {
    execFileSync(WRANGLER, args, {
      cwd,
      env: env(true),
      stdio: "inherit",
      timeout: timeoutMs,
    });
  } catch (err) {
    throw timedOut(args, err);
  }
}
