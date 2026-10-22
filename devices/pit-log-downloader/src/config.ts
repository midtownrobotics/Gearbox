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

/**
 * A Pit's address as typed (PIT_URL, or on the pairing form): its origin, so a page's address
 * pasted from the browser works too. Null when it isn't an http or https address.
 */
export function parsePitUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

const pitSetting = setting("PIT_URL");
const pitUrl = pitSetting ? parsePitUrl(pitSetting) : null;
if (pitSetting && !pitUrl) {
  fail("PIT_URL must be an address like https://1648-pit.frcgearbox.com.");
}

/**
 * `--dev` (`pnpm --filter @g3/pit-log-downloader start -- --dev`): pair with the team's Pit under
 * `pnpm dev`, through the dev gateway (http://1648-pit.gearbox.localhost:8796), whose address is
 * in the repo's .dev-ports.json.
 */
function devGateway() {
  try {
    const ports = JSON.parse(readFileSync(join(packageDir, "../../.dev-ports.json"), "utf8")) as {
      workers: Record<string, { url: string }>;
    };
    return ports.workers.gateway.url.replace(/\/+$/, "");
  } catch {
    return fail("--dev needs the repo's .dev-ports.json to find the dev gateway.");
  }
}

export const config = {
  /**
   * The Pit to pair with when it isn't the team's usual address (staging, a local Pit); null for
   * the usual one, worked out from the team number given when pairing.
   */
  pitUrl,
  /** The dev gateway (`--dev`), whose team addresses are the team's Pit; null otherwise. */
  devGateway: process.argv.includes("--dev") && !pitUrl ? devGateway() : null,
  dataDir: fromPackage(setting("DATA_DIR") ?? "data"),
  port,
  host: setting("HOST") ?? "127.0.0.1",
};

/**
 * A team's Pit: PIT_URL, else its usual address (https://1648-pit.frcgearbox.com), or with --dev
 * its address on the dev gateway (http://1648-pit.gearbox.localhost:8796).
 */
export const pitUrlFor = (teamNumber: number | string) =>
  config.pitUrl ?? teamAppUrlVia(config.devGateway ?? undefined, `frc${teamNumber}`, "pit");

/** The robot network's first three parts, as in WPILib's IP configurations: 10.TE.AM. */
export const robotNetworkOf = (teamNumber: number) =>
  `10.${Math.floor(teamNumber / 100)}.${teamNumber % 100}`;

/** An FRC team number, or null. */
export function parseTeamNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 99999 ? n : null;
}
