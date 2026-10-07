import { inTeam, withTeam } from "@g3/auth";
import { type SQL, and, countDistinct, desc, eq, gte, lt, sql, sum } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import type { EdgeDb } from "../../db";
import { netSiteUsage, netSiteUsageDaily } from "../../db/schema";
import { DAY, HOUR, localDayKey, localDayKeys, standardOffset } from "../../lib/time";

export const MAX_SITE_ROWS_PER_BATCH = 5000;

/** Hourly rows are kept this long before being rolled up into daily rows. */
export const HOURLY_RETENTION_SECONDS = 30 * DAY;
/** Daily rows are deleted after this long. */
export const DAILY_RETENTION_SECONDS = 365 * DAY;
/** Daily rollup buckets are local days of the team's box, in its standard time all year. */
/** One client's usage of one site in one hour: [hourStartTs, mac, site, dlBytes, ulBytes]. */
export type SiteRow = [ts: number, mac: string, site: string, dl: number, ul: number];

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isText = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;

export function parseSiteBatch(value: unknown): { rows: SiteRow[] } | null {
  if (typeof value !== "object" || value === null) return null;
  const { rows } = value as Record<string, unknown>;
  if (!Array.isArray(rows) || rows.length > MAX_SITE_ROWS_PER_BATCH) return null;
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== 5) return null;
    const [ts, mac, site, dl, ul] = r;
    if (!isCount(ts) || ts % HOUR !== 0) return null;
    if (!isText(mac, 64) || !isText(site, 253) || !isCount(dl) || !isCount(ul)) return null;
  }
  return { rows: rows as SiteRow[] };
}

/**
 * Stores finished hours for the team's box. Each (hour, client) in the batch replaces what was
 * there, since a re-sent hour can group sites into "(other)" differently.
 */
export async function ingestSites(db: EdgeDb, teamId: string, rows: SiteRow[]) {
  const statements = [];
  const cleared = new Set<string>();
  for (const [ts, mac] of rows) {
    const key = `${ts}|${mac}`;
    if (cleared.has(key)) continue;
    cleared.add(key);
    statements.push(
      db
        .delete(netSiteUsage)
        .where(inTeam(netSiteUsage, teamId, eq(netSiteUsage.ts, ts), eq(netSiteUsage.mac, mac))),
    );
  }
  // D1 allows 100 bound parameters per statement: 6 per row.
  for (let i = 0; i < rows.length; i += 16) {
    statements.push(
      db
        .insert(netSiteUsage)
        .values(
          withTeam(
            teamId,
            rows
              .slice(i, i + 16)
              .map(([ts, mac, site, dl, ul]) => ({ ts, mac, site, dlBytes: dl, ulBytes: ul })),
          ),
        )
        .onConflictDoUpdate({
          target: [netSiteUsage.teamId, netSiteUsage.ts, netSiteUsage.mac, netSiteUsage.site],
          set: { dlBytes: sql`excluded.dl_bytes`, ulBytes: sql`excluded.ul_bytes` },
        }),
    );
  }
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
  return { stored: rows.length };
}

/** The team's hourly rows plus its daily rollups; the rollup deletes the hourly rows it moves. */
function allSiteUsage(
  db: EdgeDb,
  teamId: string,
  where: (t: typeof netSiteUsage | typeof netSiteUsageDaily) => SQL | undefined,
) {
  const columns = (t: typeof netSiteUsage | typeof netSiteUsageDaily) => ({
    mac: t.mac,
    ts: t.ts,
    site: t.site,
    dlBytes: t.dlBytes,
    ulBytes: t.ulBytes,
  });
  return unionAll(
    db
      .select(columns(netSiteUsage))
      .from(netSiteUsage)
      .where(inTeam(netSiteUsage, teamId, where(netSiteUsage))),
    db
      .select(columns(netSiteUsageDaily))
      .from(netSiteUsageDaily)
      .where(inTeam(netSiteUsageDaily, teamId, where(netSiteUsageDaily))),
  ).as("site_usage");
}

const total = (column: Parameters<typeof sum>[0]) =>
  sql<number>`coalesce(${sum(column)}, 0)`.mapWith(Number);

/** Top sites across the team's clients, with how many devices used each. */
export async function topSites(db: EdgeDb, teamId: string, from: number, to: number, limit = 100) {
  const u = allSiteUsage(db, teamId, (t) => and(gte(t.ts, from), lt(t.ts, to)));
  return db
    .select({
      site: u.site,
      dl: total(u.dlBytes),
      ul: total(u.ulBytes),
      devices: countDistinct(u.mac),
    })
    .from(u)
    .groupBy(u.site)
    .orderBy(desc(sql`sum(${u.dlBytes} + ${u.ulBytes})`))
    .limit(limit)
    .all();
}

/** Per-client totals for one site. */
export async function siteClients(
  db: EdgeDb,
  teamId: string,
  site: string,
  from: number,
  to: number,
) {
  const u = allSiteUsage(db, teamId, (t) => and(eq(t.site, site), gte(t.ts, from), lt(t.ts, to)));
  return db
    .select({ mac: u.mac, dl: total(u.dlBytes), ul: total(u.ulBytes) })
    .from(u)
    .groupBy(u.mac)
    .orderBy(desc(sql`sum(${u.dlBytes} + ${u.ulBytes})`))
    .all();
}

/** Top sites for one client. */
export async function clientSites(
  db: EdgeDb,
  teamId: string,
  mac: string,
  from: number,
  to: number,
  limit = 50,
) {
  const u = allSiteUsage(db, teamId, (t) => and(eq(t.mac, mac), gte(t.ts, from), lt(t.ts, to)));
  return db
    .select({ site: u.site, dl: total(u.dlBytes), ul: total(u.ulBytes) })
    .from(u)
    .groupBy(u.site)
    .orderBy(desc(sql`sum(${u.dlBytes} + ${u.ulBytes})`))
    .limit(limit)
    .all();
}

/** Per-local-day totals for one site, with a zero entry for every day in range. */
export async function siteDaily(
  db: EdgeDb,
  teamId: string,
  tz: string,
  site: string,
  from: number,
  to: number,
) {
  const u = allSiteUsage(db, teamId, (t) => and(eq(t.site, site), gte(t.ts, from), lt(t.ts, to)));
  const results = await db
    .select({ ts: u.ts, dl: total(u.dlBytes), ul: total(u.ulBytes) })
    .from(u)
    .groupBy(u.ts)
    .all();
  const days = new Map(localDayKeys(from, to, tz).map((day) => [day, { dl: 0, ul: 0 }]));
  for (const r of results) {
    const d = days.get(localDayKey(r.ts, tz));
    if (!d) continue;
    d.dl += r.dl;
    d.ul += r.ul;
  }
  return [...days].map(([day, t]) => ({ day, ...t }));
}

/**
 * Moves the team's hourly rows older than 30 days into daily rows (local days of its box, in
 * standard time) and deletes its daily rows older than a year, in one atomic batch.
 */
export async function rollupSites(
  db: EdgeDb,
  teamId: string,
  tz: string,
  now = Math.floor(Date.now() / 1000),
) {
  const cutoff = Math.floor((now - HOURLY_RETENTION_SECONDS) / HOUR) * HOUR;
  // Local minus UTC: a local day starts at (UTC midnight − offset).
  const offset = sql.raw(String(Math.trunc(standardOffset(now, tz))));
  // Constants written into the SQL: bound, D1 sends them as reals and the division wouldn't floor.
  const d = sql.raw(String(DAY));
  const day = sql<number>`((${netSiteUsage.ts} + ${offset}) / ${d}) * ${d} - ${offset}`;
  const [inserted] = await db.batch([
    // Copied from the team's own rows (inTeam), team and all.
    db
      .insert(netSiteUsageDaily)
      .select(
        db
          .select({
            teamId: netSiteUsage.teamId,
            mac: netSiteUsage.mac,
            ts: day.as("ts"),
            site: netSiteUsage.site,
            dlBytes: sum(netSiteUsage.dlBytes).mapWith(Number).as("dl_bytes"),
            ulBytes: sum(netSiteUsage.ulBytes).mapWith(Number).as("ul_bytes"),
          })
          .from(netSiteUsage)
          .where(inTeam(netSiteUsage, teamId, lt(netSiteUsage.ts, cutoff)))
          .groupBy(netSiteUsage.mac, day, netSiteUsage.site),
      )
      .onConflictDoUpdate({
        target: [
          netSiteUsageDaily.teamId,
          netSiteUsageDaily.ts,
          netSiteUsageDaily.mac,
          netSiteUsageDaily.site,
        ],
        set: {
          dlBytes: sql`${netSiteUsageDaily.dlBytes} + excluded.dl_bytes`,
          ulBytes: sql`${netSiteUsageDaily.ulBytes} + excluded.ul_bytes`,
        },
      }),
    db.delete(netSiteUsage).where(inTeam(netSiteUsage, teamId, lt(netSiteUsage.ts, cutoff))),
    db
      .delete(netSiteUsageDaily)
      .where(
        inTeam(netSiteUsageDaily, teamId, lt(netSiteUsageDaily.ts, now - DAILY_RETENTION_SECONDS)),
      ),
  ]);
  console.log("[Rollup] Rolled up site usage", { teamId, cutoff, inserted });
}
