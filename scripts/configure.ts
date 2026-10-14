// `pnpm configure`: writes the values from packages/site-config/src/site.ts into the files that
// can't import it (each worker's wrangler.toml, the edge box's env example). Run it after
// changing site.ts. `pnpm configure --check` only reports files that are out of date (CI).
//
// Only production values (https URLs, route patterns) are rewritten; localhost dev values stay.
//
// It also writes each worker's staging environment (roadmap 0.2): [env.staging], made from its
// [env.production] (stagingSections below), with staging's names and addresses and the ids of
// staging's databases and KV namespaces from infra/staging/resources.json (made by
// `pnpm staging:create`). Change [env.production]; the staging part follows.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AppName,
  apiUrl,
  appUrl,
  signInCallbackApiUrl,
  site,
  teamKey,
} from "../packages/site-config/src/index.ts";

const root = join(import.meta.dirname, "..");
const check = process.argv.includes("--check");

/** Each app worker with production URLs to fill, and its app. */
const WORKERS: Record<string, Exclude<AppName, "portal">> = {
  attendance: "attendance",
  edge: "edge",
  g3id: "id",
  inventory: "inventory",
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
    httpsVar(
      "(GOOGLE|GITHUB|STEAM)_REDIRECT_URI",
      // One address for every team: the platform's id.<domain> host.
      (m) => `${signInCallbackApiUrl(teamKey)}/auth/${m[2].toLowerCase()}/callback`,
    ),
    [/^(TEAM_NUMBER = )"[^"]*"/gm, (m) => `${m[1]}"${site.team.number}"`],
  ];
}

/** G3's retired addresses on its own domain, which the production gateway answers 410 for. */
const retiredHosts = [
  ...Object.values(site.apps).flatMap(({ web }) =>
    web === null ? [] : [`${web}.${site.domain}`, `api.${web}.${site.domain}`],
  ),
  `id.${site.domain}`,
  `admin.${site.domain}`,
];

/** A route section for wrangler.toml. */
const routeSection = (env: string, pattern: string, zone: string) =>
  `[[env.${env}.routes]]\npattern = "${pattern}"\nzone_name = "${zone}"\n\n`;

/**
 * The production gateway's routes: the platform's domain and every name under it, and on G3's own
 * domain only the exact retired addresses (so staging's names there are never production's).
 */
const productionRoutes = () =>
  [
    routeSection("production", `*.${site.platformDomain}/*`, site.platformDomain),
    routeSection("production", `${site.platformDomain}/*`, site.platformDomain),
    ...retiredHosts.map((host) => routeSection("production", `${host}/*`, site.domain)),
  ].join("");

/** The staging gateway's routes: staging's names only (site.staging). */
const stagingRoutes = () => {
  const { domain, suffix } = site.staging;
  return [
    routeSection("staging", `*${suffix}.${domain}/*`, domain),
    routeSection("staging", `${suffix.replace(/^-/, "")}.${domain}/*`, domain),
  ].join("");
};

/** A production address as staging's: https://1648-orders.frcgearbox.com → https://1648-orders-dev.g3robotics.com. */
function stagingUrl(url: string): string {
  const { hostname, pathname } = new URL(url);
  const { domain, suffix } = site.staging;
  const label =
    hostname === site.platformDomain ? "" : hostname.slice(0, -site.platformDomain.length - 1);
  const host = label ? `${label}${suffix}.${domain}` : `${suffix.replace(/^-/, "")}.${domain}`;
  return `https://${host}${pathname === "/" && !url.endsWith("/") ? "" : pathname}`;
}

type Resources = {
  d1: Record<string, string>;
  kv: Record<string, string>;
  /** Staging's own Slack app (not production's): its client and app ids, which aren't secrets. */
  slack?: { clientId?: string; appId?: string };
};
const NOT_CREATED = "not-created-run-pnpm-staging-create";

/** A TOML file as the lines before its first table, then each table with its lines. */
function sections(text: string) {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => /^\[/.test(l));
  const head = first === -1 ? lines : lines.slice(0, first);
  const tables: { name: string; lines: string[] }[] = [];
  for (const line of first === -1 ? [] : lines.slice(first)) {
    const header = line.match(/^\[\[?([^\]]+)\]\]?/);
    if (header) tables.push({ name: header[1], lines: [line] });
    else tables[tables.length - 1].lines.push(line);
  }
  return { head, tables };
}

const STAGING_MARK =
  "# ---- Staging: written by `pnpm configure` from [env.production]; don't edit below. ----";

/** [env.production]'s tables as staging's (see the file's top). */
function stagingSections(tables: { name: string; lines: string[] }[], resources: Resources) {
  let kvBinding = "";
  const out: string[] = [];
  for (const table of tables) {
    if (!table.name.startsWith("env.production") || table.name === "env.production.routes") {
      continue;
    }
    const lines: string[] = [];
    for (const raw of table.lines) {
      // Production's comments stay with production.
      if (/^\s*#/.test(raw)) continue;
      let line = raw.replace(/env\.production/g, "env.staging");
      line = line.replace(
        /^((?:name|service) = )"([^"]+)-production"/,
        (_, k, n) => `${k}"${n}-staging"`,
      );
      const binding = line.match(/^binding = "([^"]+)"/);
      if (binding) kvBinding = binding[1];
      const db = raw.match(/^database_name = "([^"]+)"/);
      if (db) line = `database_name = "${db[1].replace(/-prod$/, "")}-staging"`;
      if (/^database_id = /.test(line)) {
        const name =
          lines.find((l) => l.startsWith("database_name"))?.match(/"([^"]+)"/)?.[1] ?? "";
        line = `database_id = "${resources.d1[name] ?? NOT_CREATED}"`;
      }
      if (table.name.endsWith("kv_namespaces") && /^id = /.test(line)) {
        line = `id = "${resources.kv[kvBinding] ?? NOT_CREATED}"`;
      }
      line = line.replace(
        /^((?:bucket_name|queue) = )"([^"]+)"/,
        (_, k, n) => `${k}"${n}-staging"`,
      );
      line = line.replace(/"(https:\/\/[^"]+)"/, (_, url) => `"${stagingUrl(url)}"`);
      line = line.replace(/^ENVIRONMENT = "production"/, 'ENVIRONMENT = "staging"');
      line = line.replace(/^command = "/, 'command = "GEARBOX_STAGING=1 ');
      // Staging has its own Slack app (infra/staging/resources.json): its client and app ids
      // replace production's, and production's workspace (SLACK_TEAM_ID) isn't staging's.
      const slack = line.match(/^SLACK_(CLIENT_ID|APP_ID) = /);
      if (slack) {
        const id = slack[1] === "CLIENT_ID" ? resources.slack?.clientId : resources.slack?.appId;
        if (!id) continue;
        line = `${slack[0]}"${id}"`;
      } else if (/^SLACK_/.test(line)) continue;
      lines.push(line);
    }
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    out.push(lines.join("\n"));
    if (table.name === "env.production") {
      // Staging's addresses (`isStaging` in @g3/site-config).
      out.push('[env.staging.define]\n__G3_STAGING__ = "true"');
    }
  }
  return out.join("\n\n");
}

/** A worker's wrangler.toml with its staging part (and the gateway's routes) written. */
function withStaging(path: string, text: string, resources: Resources): string {
  const own = text.includes(STAGING_MARK) ? text.slice(0, text.indexOf(STAGING_MARK)) : text;
  let base = own.replace(/\n+$/, "\n");
  if (path.includes("/gateway/")) {
    const { head, tables } = sections(base);
    const kept = tables.filter((t) => t.name !== "env.production.routes");
    const at = kept.findIndex((t) => t.name === "env.production");
    const routes = {
      name: "env.production.routes",
      lines: productionRoutes().replace(/\n$/, "").split("\n"),
    };
    kept.splice(at + 1, 0, routes);
    base = [...head, ...kept.flatMap((t) => t.lines)].join("\n").replace(/\n+$/, "\n");
  }
  const { tables } = sections(base);
  if (!tables.some((t) => t.name === "env.production")) return text;
  let staging = stagingSections(tables, resources);
  if (path.includes("/gateway/")) staging += `\n\n${stagingRoutes().replace(/\n+$/, "")}`;
  return `${base}\n${STAGING_MARK}\n\n${staging}\n`;
}

const FILES: [path: string, rules: Rule[]][] = [
  ...Object.entries(WORKERS).map(
    ([dir, app]) => [`workers/${dir}/wrangler.toml`, wranglerRules(app)] as [string, Rule[]],
  ),
  [
    "infra/edge/etc/g3-edge/agent.env.example",
    [[/^(EDGE_WORKER_URL=)https:\/\/\S*/gm, (m) => `${m[1]}${apiUrl("edge")}`]],
  ],
];

const resources = JSON.parse(
  readFileSync(join(root, "infra/staging/resources.json"), "utf8"),
) as Resources;

let stale = 0;
for (const [path, rules] of [
  ...FILES,
  ["workers/gateway/wrangler.toml", []] as [string, Rule[]],
  ["workers/portal/wrangler.toml", []] as [string, Rule[]],
  ["workers/platform/wrangler.toml", []] as [string, Rule[]],
]) {
  const file = join(root, path);
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const [pattern, value] of rules) {
    after = after.replace(pattern, (...args) => value(args.slice(0, -2) as RegExpMatchArray));
  }
  if (path.endsWith("wrangler.toml")) after = withStaging(path, after, resources);
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
