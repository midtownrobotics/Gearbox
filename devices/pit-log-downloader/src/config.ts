// Settings from config.env (see config.env.example). Every one is optional: the team comes from
// pairing with its Pit (gearbox.ts). Relative paths start from the package's folder, so the
// downloader finds its files whichever folder it's started from.

import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { teamAppUrlVia } from "@g3/site-config";

const packageDir = join(import.meta.dirname, "..");
const fromPackage = (path: string) => (isAbsolute(path) ? path : resolve(packageDir, path));
const setting = (name: string) => process.env[name]?.trim() || undefined;

function fail(message: string): never {
  console.error(
    `${message}\nChange it in ${join(packageDir, "config.env")} (see config.env.example).`,
  );
  process.exit(1);
}

const port = Number(setting("PORT") ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail("PORT must be a port number.");

const pitUrl = setting("PIT_URL")?.replace(/\/+$/, "") ?? null;
if (pitUrl && !/^https?:\/\/[^/]+$/.test(pitUrl)) {
  fail("PIT_URL must be an address like https://1648-pit.frcgearbox.com.");
}

/**
 * `--dev` (`pnpm --filter @g3/pit-log-downloader start -- --dev`): pair with the Pit worker
 * running here under `pnpm dev`, at its port in the repo's .dev-ports.json.
 */
const dev = process.argv.includes("--dev");

function localPitUrl() {
  try {
    const ports = JSON.parse(readFileSync(join(packageDir, "../../.dev-ports.json"), "utf8")) as {
      workers: Record<string, { url: string }>;
    };
    return ports.workers.pit.url.replace(/\/+$/, "");
  } catch {
    return fail("--dev needs the repo's .dev-ports.json to find the local Pit.");
  }
}

export const config = {
  /** Null when logs stay on this computer only. */
  driveFolderId: setting("DRIVE_FOLDER_ID") ?? null,
  /**
   * The Pit to pair with when it isn't the team's usual address (staging, a local Pit); null for
   * the usual one, worked out from the team number given when pairing.
   */
  pitUrl: pitUrl ?? (dev ? localPitUrl() : null),
  /** Pairing with the local Pit (`--dev`), which takes the team from a header, like the gateway. */
  dev: dev && !pitUrl,
  googleKeyFile: fromPackage(setting("GOOGLE_KEY_FILE") ?? "service-account-key.json"),
  dataDir: fromPackage(setting("DATA_DIR") ?? "data"),
  port,
  host: setting("HOST") ?? "127.0.0.1",
};

/** A team's Pit: PIT_URL, else its usual address (https://1648-pit.frcgearbox.com). */
export const pitUrlFor = (teamNumber: number) =>
  config.pitUrl ?? teamAppUrlVia(undefined, `frc${teamNumber}`, "pit");

/** The robot network's first three parts, as in WPILib's IP configurations: 10.TE.AM. */
export const robotNetworkOf = (teamNumber: number) =>
  `10.${Math.floor(teamNumber / 100)}.${teamNumber % 100}`;

/** Headers for the team's Pit: the team itself, on the local Pit, which has no gateway. */
export const pitHeaders = (teamNumber: number): Record<string, string> =>
  config.dev ? { "X-Team-Id": `frc${teamNumber}` } : {};

/** An FRC team number, or null. */
export function parseTeamNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 99999 ? n : null;
}
