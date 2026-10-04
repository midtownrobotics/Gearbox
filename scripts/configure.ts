// `pnpm configure`: writes the values from packages/site-config/src/site.ts into the files that
// can't import it (each worker's wrangler.toml, the edge box's env example). Run it after
// changing site.ts. `pnpm configure --check` only reports files that are out of date (CI).
//
// Only production values (https URLs, route patterns) are rewritten; localhost dev values stay.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AppName,
  apiUrl,
  appUrl,
  edgeAgentUrl,
  site,
} from "../packages/site-config/src/index.ts";

const root = join(import.meta.dirname, "..");
const check = process.argv.includes("--check");

/** Each app worker with production URLs to fill, and its app. */
const WORKERS: Record<string, Exclude<AppName, "portal">> = {
  attendance: "attendance",
  edge: "edge",
  g3id: "id",
  orders: "orders",
  pit: "pit",
  scouting: "scouting",
  shop: "shop",
  "skill-tree": "skillTree",
};

type Rule = [pattern: RegExp, value: (match: RegExpMatchArray) => string];

/** `KEY = "https://…"` → `KEY = "<value>"` (dev values aren't https, so they're left alone). */
const httpsVar = (key: string, value: (m: RegExpMatchArray) => string): Rule => [
  new RegExp(`^(${key} = )"https://[^"]*"`, "gm"),
  (m) => `${m[1]}"${value(m)}"`,
];

function wranglerRules(app: Exclude<AppName, "portal">): Rule[] {
  return [
    httpsVar("FRONTEND_URL", () => appUrl(app)),
    // Orders' Share-A-Cart OAuth callbacks.
    httpsVar("PUBLIC_API_URL", () => apiUrl(app)),
    httpsVar("EDGE_AGENT_URL", () => edgeAgentUrl),
    httpsVar(
      "(GOOGLE|GITHUB|STEAM|ONSHAPE)_REDIRECT_URI",
      (m) => `${apiUrl("id")}/auth/${m[2].toLowerCase()}/callback`,
    ),
    [/^(TEAM_NUMBER = )"[^"]*"/gm, (m) => `${m[1]}"${site.team.number}"`],
  ];
}

const FILES: [path: string, rules: Rule[]][] = [
  ...Object.entries(WORKERS).map(
    ([dir, app]) => [`workers/${dir}/wrangler.toml`, wranglerRules(app)] as [string, Rule[]],
  ),
  [
    // The gateway worker answers every subdomain.
    "workers/gateway/wrangler.toml",
    [
      [/^(pattern = )"[^"]*"/gm, (m) => `${m[1]}"*.${site.domain}/*"`],
      [/^(zone_name = )"[^"]*"/gm, (m) => `${m[1]}"${site.domain}"`],
    ],
  ],
  [
    "workers/edge/.dev.vars.example",
    [[/^(#?LOOKUP_AGENT_URL=)https:\/\/\S*/gm, (m) => `${m[1]}${edgeAgentUrl}`]],
  ],
  [
    "infra/edge/etc/g3-edge/agent.env.example",
    [[/^(EDGE_WORKER_URL=)https:\/\/\S*/gm, (m) => `${m[1]}${apiUrl("edge")}`]],
  ],
];

let stale = 0;
for (const [path, rules] of FILES) {
  const file = join(root, path);
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const [pattern, value] of rules) {
    after = after.replace(pattern, (...args) => value(args.slice(0, -2) as RegExpMatchArray));
  }
  if (after === before) continue;
  stale++;
  if (check) {
    console.error(`${path} doesn't match site.ts (run pnpm configure)`);
  } else {
    writeFileSync(file, after);
    console.log(`updated ${path}`);
  }
}

if (check && stale > 0) process.exit(1);
if (!check) console.log(stale ? "Done." : "Everything already matches site.ts.");
