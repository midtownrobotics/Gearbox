import { inTeam } from "@g3/auth";
import { type SQL, and, asc, eq, gte, lt, min, sql, sum } from "drizzle-orm";
import { unionAll } from "drizzle-orm/sqlite-core";
import type { EdgeDb } from "../../db";
import { netUsage, netUsageHourly } from "../../db/schema";
import { DAY, HOUR, localDayKey, localDayKeys } from "../../lib/time";

/**
 * The team's raw 5-minute rows plus its rolled-up hourly rows, as one table. The rollup deletes
 * raw rows as it moves them, so the two never overlap.
 */
function allUsage(
  db: EdgeDb,
  teamId: string,
  where: (t: typeof netUsage | typeof netUsageHourly) => SQL | undefined,
) {
  const columns = (t: typeof netUsage | typeof netUsageHourly) => ({
    mac: t.mac,
    ts: t.ts,
    dlBytes: t.dlBytes,
    ulBytes: t.ulBytes,
  });
  return unionAll(
    db
      .select(columns(netUsage))
      .from(netUsage)
      .where(inTeam(netUsage, teamId, where(netUsage))),
    db
      .select(columns(netUsageHourly))
      .from(netUsageHourly)
      .where(inTeam(netUsageHourly, teamId, where(netUsageHourly))),
  ).as("usage");
}

const between = (from: number, to: number) => (t: typeof netUsage | typeof netUsageHourly) =>
  and(gte(t.ts, from), lt(t.ts, to));

export interface Totals {
  dl: number;
  ul: number;
}

const total = (column: Parameters<typeof sum>[0]) =>
  sql<number>`coalesce(${sum(column)}, 0)`.mapWith(Number);

export async function totalsByMac(db: EdgeDb, teamId: string, from: number, to: number) {
  const u = allUsage(db, teamId, between(from, to));
  const results = await db
    .select({ mac: u.mac, dl: total(u.dlBytes), ul: total(u.ulBytes) })
    .from(u)
    .groupBy(u.mac)
    .all();
  return new Map(results.map((r) => [r.mac, { dl: r.dl, ul: r.ul }]));
}

export async function hourlyFor(db: EdgeDb, teamId: string, mac: string, from: number, to: number) {
  const u = allUsage(db, teamId, (t) => and(eq(t.mac, mac), gte(t.ts, from), lt(t.ts, to)));
  // Constants written into the SQL: bound, D1 sends them as reals and the division wouldn't floor.
  const h = sql.raw(String(HOUR));
  const hour = sql<number>`(${u.ts} / ${h}) * ${h}`.mapWith(Number);
  return db
    .select({ hour, dl: total(u.dlBytes), ul: total(u.ulBytes) })
    .from(u)
    .groupBy(hour)
    .orderBy(asc(hour))
    .all();
}

/** Per-local-day totals for one client, with a zero entry for every day in range. */
export async function dailyFor(
  db: EdgeDb,
  teamId: string,
  tz: string,
  mac: string,
  from: number,
  to: number,
) {
  // Hour buckets align with local days in zones whose UTC offset is whole hours.
  const hours = await hourlyFor(db, teamId, mac, from, to);
  const days = new Map(localDayKeys(from, to, tz).map((day) => [day, { dl: 0, ul: 0 }]));
  for (const h of hours) {
    const d = days.get(localDayKey(h.hour, tz));
    if (!d) continue;
    d.dl += h.dl;
    d.ul += h.ul;
  }
  return [...days].map(([day, t]) => ({ day, ...t }));
}

export async function earliestSample(db: EdgeDb, teamId: string, mac: string) {
  const u = allUsage(db, teamId, (t) => eq(t.mac, mac));
  const row = await db
    .select({ ts: min(u.ts) })
    .from(u)
    .get();
  return row?.ts ?? null;
}

/**
 * Month-end projections. `runRate` extrapolates the whole cycle so far;
 * `sevenDayPace` adds the last 7 days' average rate to what's already used.
 * Both are null until there's at least 6 hours of data to go on.
 */
export function project(args: {
  used: number;
  now: number;
  cycleStart: number;
  cycleEnd: number;
  recentBytes: number;
  recentSeconds: number;
}) {
  const { used, now, cycleStart, cycleEnd, recentBytes, recentSeconds } = args;
  const elapsed = now - cycleStart;
  const remaining = Math.max(0, cycleEnd - now);
  const minimum = 6 * HOUR;
  return {
    runRate: elapsed >= minimum ? Math.round((used / elapsed) * (cycleEnd - cycleStart)) : null,
    sevenDayPace:
      recentSeconds >= minimum
        ? Math.round(used + (recentBytes / recentSeconds) * remaining)
        : null,
  };
}

export const SEVEN_DAYS = 7 * DAY;
