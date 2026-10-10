// Stores the hash of an existing box key for a team, so that box keeps connecting with the key it
// has. Two uses (new boxes get their key on the Edge Box page instead):
//
// - The Phase 3 deploy: G3's box already has the old shared key (the EDGE_AGENT_KEY secret). Store
//   it as G3's box key before deploying, then delete the secret:
//     EDGE_AGENT_KEY=<the key> pnpm --filter @g3/worker-edge box-key:set
// - Local dev: the mock agent's key (mock.env) for the site team:
//     pnpm --filter @g3/worker-edge box-key:set -- --local --key local-dev-agent-key
//
// Options: --team frc<number> (default: the site team), --key <key> (default: $EDGE_AGENT_KEY),
// --local (the local dev database; default: production).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { teamKey } from "@g3/site-config";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const team = option("team") ?? teamKey;
const key = option("key") ?? process.env.EDGE_AGENT_KEY;
const local = args.includes("--local");

if (!/^frc[1-9]\d*$/.test(team))
  throw new Error(`--team must be a team id like frc1648, not ${team}`);
if (!key || key.length < 16) throw new Error("Give the box's key: --key <key> or EDGE_AGENT_KEY.");

const hash = createHash("sha256").update(key).digest("hex");
const now = Math.floor(Date.now() / 1000);
const command = `INSERT INTO edge_boxes (team_id, key_hash, key_hint, created_by, created_by_name, created_at)
VALUES ('${team}', '${hash}', '${key.slice(-4).replace(/'/g, "")}', 'set-box-key', 'Deploy script', ${now})
ON CONFLICT (team_id) DO UPDATE SET key_hash = excluded.key_hash, key_hint = excluded.key_hint,
  created_by = excluded.created_by, created_by_name = excluded.created_by_name,
  created_at = excluded.created_at;`;

// Wrangler's own entry, run with this Node: `pnpm` and `wrangler` are .cmd files on Windows,
// which can't be started without a shell (and a shell would mangle the command's quotes).
const require = createRequire(import.meta.url);
const wranglerPackage = require.resolve("wrangler/package.json");
const wrangler = join(dirname(wranglerPackage), require(wranglerPackage).bin.wrangler);

execFileSync(
  process.execPath,
  [
    wrangler,
    "d1",
    "execute",
    "EDGE_DB",
    ...(local ? ["--local"] : ["--remote", "--env", "production"]),
    "--command",
    command,
  ],
  // A URL's own path is "/C:/…" on Windows, which isn't a folder there.
  { stdio: "inherit", cwd: fileURLToPath(new URL("..", import.meta.url)) },
);
console.log(`Stored the box key ending ${key.slice(-4)} for ${team}${local ? " (local)" : ""}.`);
