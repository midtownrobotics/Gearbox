// Settings from config.env (see config.env.example). Relative paths start from the package's
// folder, so the downloader finds its files whichever folder it's started from.

import { isAbsolute, join, resolve } from "node:path";

const packageDir = join(import.meta.dirname, "..");
const fromPackage = (path: string) => (isAbsolute(path) ? path : resolve(packageDir, path));
const setting = (name: string) => process.env[name]?.trim() || undefined;

function fail(message: string): never {
  console.error(
    `${message}\nSet it in ${join(packageDir, "config.env")} (see config.env.example).`,
  );
  process.exit(1);
}

const teamNumber = Number(setting("TEAM_NUMBER"));
if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 99999) {
  fail("TEAM_NUMBER must be your FRC team number.");
}

const port = Number(setting("PORT") ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail("PORT must be a port number.");

/** The robot network's first three parts, as in WPILib's IP configurations: 10.TE.AM. */
const robotNetworkBaseIp = `10.${Math.floor(teamNumber / 100)}.${teamNumber % 100}`;

export const config = {
  teamNumber,
  robotNetworkBaseIp,
  rioIp: `${robotNetworkBaseIp}.2`,
  /** Null when logs stay on this computer only. */
  driveFolderId: setting("DRIVE_FOLDER_ID") ?? null,
  googleKeyFile: fromPackage(setting("GOOGLE_KEY_FILE") ?? "service-account-key.json"),
  dataDir: fromPackage(setting("DATA_DIR") ?? "data"),
  port,
  host: setting("HOST") ?? "127.0.0.1",
};
