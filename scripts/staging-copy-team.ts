// `pnpm staging:copy-team -- [--dry-run] [--only <worker>,...]`: copies the site's own team's data
// (G3's, site.ts) from production's D1 databases into staging's, replacing what staging has for
// it, so a release (and its migrations) can be tried on real data first (roadmap: "Rehearse on
// staging with a copy of production data"). Production is only read.
//
// Only the site's team: it runs the platform, so a copy is its own choice about its own data. Any
// other team's would go against the privacy draft (docs/legal/privacy-policy.md: operators look at
// a team's data only to fix what it reports or for abuse, and a removed member is gone within 30
// days), so it isn't offered.
//
// For each database: the team's rows of every table with a `team_id`, and the tables that belong to
// the team through another (`LINKED`). Left out on purpose (`SKIP`, `KEEP_OUT`): sessions, sign-in
// and kiosk codes, kiosk devices and PINs, the Slack installation and every setting encrypted with
// production's SECRETS_KEY (staging has its own key and couldn't read them), the edge box's key,
// per-student browsing data, caches, and the platform's operator records. Scouting isn't per team
// yet and only the site's team has it, so for the site's team its whole database is copied.
// Not copied: KV (members sign in again on staging) and R2 files (Shop's drawings, Scouting's field
// maps), which pages show as missing.
//
// Staging must be on the same migrations as production (they're compared first; deploy staging, or
// `pnpm db:migrate:staging`, if not). `--dry-run` writes the SQL files it would run, says where,
// and changes nothing. `--local` reads and writes your local dev databases instead (to try it
// out: copying a team onto itself should leave every table as it was). Needs a Wrangler login that can see both (scripts/lib/wrangler.ts).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { site } from "../packages/site-config/src/site.ts";
import { root, scratch, wranglerLive, wranglerOutput } from "./lib/wrangler.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

/** The site's own team (G3), the only one copied (see the top of the file). */
const team = `frc${site.team.number}`;
const dryRun = flag("--dry-run");
const local = flag("--local");
const only = option("--only")?.split(",");

/** How a table's rows for the team are found: a WHERE clause, with :team for the team's id. */
type Rule = string;

type Database = {
  /** The worker's folder (its wrangler.toml names the database). */
  worker: string;
  binding: string;
  /** Tables with no team_id that belong to the team through another, parents first. */
  linked?: Record<string, Rule>;
  /** Tables that are never copied. */
  skip?: string[];
  /** Extra conditions on a table's rows (rows to leave out). */
  keepOut?: Record<string, string>;
  /** Columns copied as NULL (secrets, tokens). */
  blank?: Record<string, string[]>;
  /** The whole database is the site team's (an app that isn't per team yet). */
  wholeForSiteTeam?: boolean;
  /** Other team ids whose rows come too (Orders' shared starter catalog). */
  alsoTeams?: string[];
  /**
   * Run on staging before its rows for the team are deleted: staging's own rows that point at them
   * and aren't copied (sessions, codes, kiosks), so nothing is left pointing at a deleted row.
   */
  beforeDelete?: string[];
};

/** G3ID's team members on staging. */
const STAGING_MEMBERS = "(SELECT id FROM core_users WHERE team_id = :team)";

const DATABASES: Database[] = [
  {
    worker: "g3id",
    binding: "DB",
    linked: {
      // Before the team's own tables: core_users points at it.
      teams: "id = :team",
      core_user_identities: "user_id IN (SELECT id FROM core_users WHERE team_id = :team)",
    },
    skip: [
      "core_sessions",
      "core_slack_link_codes",
      "core_user_pins",
      "kiosk_devices",
      "kiosk_activation_codes",
      "slack_installations",
    ],
    // Sign-in providers' own tokens; signing in on staging gets new ones.
    blank: { core_user_identities: ["access_token", "refresh_token", "token_expires_at"] },
    // As G3ID's own team deletion does (DELETE_TEAM in src/routes/internal.ts).
    beforeDelete: [
      `DELETE FROM core_sessions WHERE user_id IN ${STAGING_MEMBERS};`,
      `DELETE FROM core_slack_link_codes WHERE team_id = :team OR user_id IN ${STAGING_MEMBERS};`,
      `DELETE FROM core_user_pins WHERE team_id = :team OR user_id IN ${STAGING_MEMBERS};`,
      `DELETE FROM kiosk_activation_codes WHERE team_id = :team OR created_by IN ${STAGING_MEMBERS};`,
      `DELETE FROM kiosk_devices WHERE team_id = :team OR created_by IN ${STAGING_MEMBERS};`,
      `UPDATE slack_installations SET installed_by = NULL WHERE installed_by IN ${STAGING_MEMBERS};`,
    ],
  },
  {
    worker: "platform",
    binding: "PLATFORM_DB",
    linked: { teams: "id = :team" },
    skip: ["operator_actions"],
  },
  { worker: "attendance", binding: "ATTENDANCE_DB" },
  {
    worker: "edge",
    binding: "EDGE_DB",
    // The box's key, and each student's browsing (admin-only data that a rehearsal doesn't need).
    skip: ["edge_boxes", "net_site_usage", "net_site_usage_daily"],
  },
  { worker: "inventory", binding: "INVENTORY_DB" },
  {
    worker: "orders",
    binding: "ORDERS_DB",
    skip: ["lookup_cache"],
    // Share-A-Cart's account, encrypted with production's key.
    keepOut: { app_settings: "key NOT LIKE 'sac\\_%' ESCAPE '\\'" },
    alsoTeams: ["starter"],
  },
  { worker: "pit", binding: "PIT_DB" },
  {
    worker: "shop",
    binding: "SHOP_DB",
    // Onshape's keys, encrypted with production's key.
    keepOut: {
      admin_settings:
        "key NOT IN ('onshape_api_key', 'onshape_api_secret', 'onshape_webhook_key_primary', 'onshape_webhook_key_secondary')",
    },
  },
  {
    worker: "skill-tree",
    binding: "SKILL_DB",
    linked: {
      trees: "tree_set_id IN (SELECT id FROM tree_sets WHERE team_id = :team)",
      tree_categories:
        "tree_id IN (SELECT id FROM trees WHERE tree_set_id IN (SELECT id FROM tree_sets WHERE team_id = :team))",
      category_prereqs:
        "category_id IN (SELECT id FROM tree_categories WHERE tree_id IN (SELECT id FROM trees WHERE tree_set_id IN (SELECT id FROM tree_sets WHERE team_id = :team)))",
      skills: "tree_set_id IN (SELECT id FROM tree_sets WHERE team_id = :team)",
      skill_prereqs:
        "skill_id IN (SELECT id FROM skills WHERE tree_set_id IN (SELECT id FROM tree_sets WHERE team_id = :team))",
      skill_progress:
        "skill_id IN (SELECT id FROM skills WHERE tree_set_id IN (SELECT id FROM tree_sets WHERE team_id = :team))",
    },
  },
  {
    worker: "scouting",
    binding: "SCOUTING_DB",
    wholeForSiteTeam: true,
    skip: [
      "tba_match_cache",
      "tba_team_cache",
      "manual_scan_cache",
      "manual_scan_usage",
      "strategy_presence",
    ],
    blank: { strategy_event_config: ["tba_auth_key", "nexus_api_key"] },
  },
];

type Row = Record<string, unknown>;

/** How many times a read is tried: a request to Cloudflare sometimes fails ("fetch failed"). */
const ATTEMPTS = 4;

/** Runs a read on one side and gives back its rows, trying again if the request fails. */
function query(db: Database, side: "production" | "staging", sql: string): Row[] {
  const where = local ? ["--local"] : ["--env", side, "--remote"];
  for (let attempt = 1; ; attempt++) {
    try {
      const out = wranglerOutput(
        ["d1", "execute", db.binding, ...where, "--json", "--command", sql],
        { cwd: join(root, "workers", db.worker), quiet: true },
      );
      const results = JSON.parse(out) as { results: Row[] }[];
      return results.flatMap((r) => r.results);
    } catch (err) {
      // Wrangler's own error, when it gave one ({"error": {"text": ...}} on its output).
      const printed = String((err as { stdout?: string }).stdout ?? "");
      const reason =
        printed.match(/"text":\s*"([^"]+)"/)?.[1] ??
        (err instanceof Error ? err.message : String(err));
      if (attempt >= ATTEMPTS) {
        throw new Error(`Reading ${db.worker} (${side}) failed ${ATTEMPTS} times: ${reason}`);
      }
      console.log(`  (${reason}; trying again)`);
      sleep(2000 * attempt);
    }
  }
}

/** Waits, without anything else to do in the meantime. */
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** A value as an SQL literal. */
function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

const PAGE = 2000;

/** Every row matching `where`, a page at a time. */
function rowsOf(db: Database, table: string, where: string): Row[] {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = query(
      db,
      "production",
      `SELECT * FROM ${quote(table)} WHERE ${where} ORDER BY rowid LIMIT ${PAGE} OFFSET ${offset}`,
    );
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const migrations = (db: Database, side: "production" | "staging") =>
  query(db, side, "SELECT name FROM d1_migrations ORDER BY name")
    .map((r) => String(r.name))
    .join(",");

const outDir = join(scratch, "copy");
mkdirSync(outDir, { recursive: true });
const teamList = (db: Database) =>
  [team, ...(db.alsoTeams ?? [])].map((t) => literal(t)).join(", ");

console.log(
  `Copying ${team} from ${local ? "your local databases to themselves" : "production to staging"}${dryRun ? " (dry run)" : ""}.`,
);

for (const db of DATABASES) {
  if (only && !only.includes(db.worker)) continue;
  const whole = db.wholeForSiteTeam === true;
  console.log(`\n${db.worker}:`);

  if (migrations(db, "production") !== migrations(db, "staging")) {
    console.log(
      "  skipped: staging isn't on production's migrations. Deploy staging (or pnpm db:migrate:staging) and run this again.",
    );
    continue;
  }

  const columns = query(
    db,
    "production",
    "SELECT m.name AS tbl, p.name AS col FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' AND m.name != 'd1_migrations'",
  );
  const tables = new Map<string, string[]>();
  for (const { tbl, col } of columns) {
    tables.set(String(tbl), [...(tables.get(String(tbl)) ?? []), String(col)]);
  }

  // Which rows of each table are the team's, in the order they go in (parents first).
  const linkedFirst = whole ? [] : Object.keys(db.linked ?? {}).filter((t) => t === "teams");
  const plan: { table: string; where: string }[] = [];
  const left: string[] = [];
  for (const table of [...linkedFirst, ...[...tables.keys()].sort()]) {
    if (plan.some((p) => p.table === table) || db.skip?.includes(table)) continue;
    let where: string | undefined;
    if (whole) where = "1 = 1";
    else if (db.linked?.[table]) where = db.linked[table].replaceAll(":team", literal(team));
    else if (tables.get(table)?.includes("team_id")) where = `team_id IN (${teamList(db)})`;
    if (!where) {
      left.push(table);
      continue;
    }
    if (db.keepOut?.[table]) where = `(${where}) AND ${db.keepOut[table]}`;
    plan.push({ table, where });
  }
  // Linked tables after the team's own, in the order they're listed.
  if (!whole) {
    plan.sort((a, b) => {
      const order = (t: string) =>
        t === "teams" ? -1 : db.linked?.[t] ? 1 + Object.keys(db.linked).indexOf(t) : 0;
      return order(a.table) - order(b.table);
    });
  }

  const sql: string[] = [
    "PRAGMA defer_foreign_keys = ON;",
    ...(db.beforeDelete ?? []).map((s) => s.replaceAll(":team", literal(team))),
  ];
  // Staging's rows for the team go first, children before parents. Linked tables' rows are found
  // through staging's own parents, so they're deleted before those.
  for (const { table, where } of [...plan].reverse()) {
    if (table === "teams") continue; // Kept: the team stays registered, and is overwritten below.
    sql.push(`DELETE FROM ${quote(table)} WHERE ${where};`);
  }
  let total = 0;
  for (const { table, where } of plan) {
    const rows = rowsOf(db, table, where);
    const blank = new Set(db.blank?.[table] ?? []);
    for (const row of rows) {
      const cols = Object.keys(row);
      const values = cols.map((c) => (blank.has(c) ? "NULL" : literal(row[c])));
      const verb = table === "teams" ? "INSERT OR REPLACE" : "INSERT";
      sql.push(
        `${verb} INTO ${quote(table)} (${cols.map(quote).join(", ")}) VALUES (${values.join(", ")});`,
      );
    }
    total += rows.length;
    console.log(`  ${table}: ${rows.length}`);
  }
  if (left.length) console.log(`  not copied (not the team's): ${left.join(", ")}`);

  const file = join(outDir, `${db.worker}.sql`);
  writeFileSync(file, `${sql.join("\n")}\n`);
  if (dryRun) {
    console.log(`  would load ${total} rows into staging: ${file}`);
    continue;
  }
  console.log(`  loading ${total} rows into staging…`);
  // All or nothing (a failed load leaves staging as it was), and it replaces what's there, so a
  // load that fails on Cloudflare's side (D1_RESET_DO, "fetch failed") is simply tried again.
  for (let attempt = 1; ; attempt++) {
    try {
      wranglerLive(
        [
          "d1",
          "execute",
          db.binding,
          ...(local ? ["--local"] : ["--env", "staging", "--remote"]),
          "--yes",
          "--file",
          file,
        ],
        { cwd: join(root, "workers", db.worker), timeoutMs: 15 * 60_000 },
      );
      break;
    } catch (err) {
      if (attempt >= ATTEMPTS) {
        console.log(
          `\n  Loading ${db.worker} failed ${ATTEMPTS} times; staging's ${db.worker} is as it was. Run this again later with --only ${DATABASES.map(
            (d) => d.worker,
          )
            .slice(DATABASES.indexOf(db))
            .join(",")} to finish.`,
        );
        throw err;
      }
      console.log(`  (the load didn't go through; trying again in ${attempt * 5} s)`);
      sleep(5000 * attempt);
    }
  }
}

console.log(
  dryRun
    ? `\nDry run: staging wasn't changed. The SQL files are in ${outDir}.`
    : "\nDone. Members sign in again on staging; files in R2 weren't copied.",
);
