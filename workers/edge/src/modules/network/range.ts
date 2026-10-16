import type { Context } from "hono";
import { validator } from "hono/validator";
import { DAY, billingCycle, localDayKey, localMidnight, localParts } from "../../lib/time";
import type { AppEnv } from "../../types";

// The dates a Network page looks at (its `?from=` and `?to=`, local days of the team's box), and
// what's worth knowing about usage over them: totals, the average day, the busiest one, and
// which weekdays and hours of the day the traffic comes at. The billing cycle stays the default,
// and the cap and its projection are always about the cycle.

/**
 * Declares a route's `?from=&to=` (so the pages' typed client can send them); `rangeOf` reads
 * and checks them.
 */
export const rangeQuery = validator("query", (value) => ({
  from: typeof value.from === "string" ? value.from : undefined,
  to: typeof value.to === "string" ? value.to : undefined,
}));

/** Longest range a page may ask for: the year daily site rows are kept, and a little more. */
export const MAX_RANGE_DAYS = 400;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type Range = {
  /** First local day, inclusive, and the day after the last (unix seconds). */
  from: number;
  to: number;
  /** The same as "YYYY-MM-DD" local days, both inclusive. */
  fromDay: string;
  toDay: string;
  /** The current billing cycle: the range when none was asked for. */
  isCycle: boolean;
  /** Days in the range, and how many of them have started (averages leave out the future). */
  days: number;
  daysSoFar: number;
};

const midnightOf = (key: string, tz: string, plusDays = 0) => {
  const m = DAY_KEY.exec(key);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return localMidnight(y, mo, d + plusDays, tz);
};

/** Days from one local midnight to another (DST days are 23 or 25 hours, so round). */
const daysBetween = (from: number, to: number) => Math.max(0, Math.round((to - from) / DAY));

/**
 * The range a request asks for (`?from=YYYY-MM-DD&to=YYYY-MM-DD`, either may be left out), or the
 * current billing cycle; or the reason it isn't one.
 */
export function rangeOf(
  c: Context<AppEnv>,
  now: number,
  tz: string,
  cycleStartDay: number,
): Range | { error: string } {
  const cycle = billingCycle(now, cycleStartDay, tz);
  const fromQ = c.req.query("from");
  const toQ = c.req.query("to");
  if (!fromQ && !toQ) return describe(cycle.start, cycle.end, now, tz, true);
  const today = localDayKey(now, tz);
  const from = midnightOf(fromQ ?? localDayKey(cycle.start, tz), tz);
  const to = midnightOf(toQ ?? today, tz, 1);
  if (from === null || to === null) return { error: "Dates must look like 2026-10-09." };
  if (to <= from) return { error: "The range must end on or after the day it starts." };
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    return { error: `Pick at most ${MAX_RANGE_DAYS} days.` };
  }
  return describe(from, to, now, tz, from === cycle.start && to === cycle.end);
}

function describe(from: number, to: number, now: number, tz: string, isCycle: boolean): Range {
  return {
    from,
    to,
    fromDay: localDayKey(from, tz),
    toDay: localDayKey(to - 1, tz),
    isCycle,
    days: daysBetween(from, to),
    daysSoFar: now < from ? 0 : daysBetween(from, Math.min(to, nextMidnight(now, tz))),
  };
}

/** Local midnight after `ts` (the end of its day). */
function nextMidnight(ts: number, tz: string) {
  const p = localParts(ts, tz);
  return localMidnight(p.year, p.month, p.day + 1, tz);
}

type Bytes = { dl: number; ul: number };
const sum = (u: Bytes) => u.dl + u.ul;

/** Monday first, as the charts show them. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** 0 = Monday … 6 = Sunday, for a local "YYYY-MM-DD" day. */
const weekdayOf = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;

/**
 * What a range's usage says: its total, the average day (over the days that have started), the
 * busiest day, and the average for each weekday and, from hourly rows, each hour of the day.
 * `hourly` may be left out (site data is daily after 30 days), and `byHour` is then null.
 */
export function usageStats(
  range: Range,
  daily: ({ day: string } & Bytes)[],
  hourly: ({ hour: number } & Bytes)[] | null,
  now: number,
  tz: string,
) {
  const today = localDayKey(now, tz);
  const past = daily.filter((d) => d.day <= today);
  const total = past.reduce((t, d) => ({ dl: t.dl + d.dl, ul: t.ul + d.ul }), { dl: 0, ul: 0 });
  const busiest = past.reduce<({ day: string } & Bytes) | null>(
    (best, d) => (sum(d) > 0 && (!best || sum(d) > sum(best)) ? d : best),
    null,
  );
  const quietest = past.reduce<({ day: string } & Bytes) | null>(
    (least, d) => (d.day < today && (!least || sum(d) < sum(least)) ? d : least),
    null,
  );

  const weekdays = WEEKDAYS.map(() => ({ bytes: 0, days: 0 }));
  for (const d of past) {
    const w = weekdays[weekdayOf(d.day)];
    w.bytes += sum(d);
    w.days++;
  }

  let byHour: number[] | null = null;
  if (hourly) {
    const hours = Array.from({ length: 24 }, () => 0);
    for (const h of hourly) {
      if (h.hour >= now) continue;
      hours[localParts(h.hour, tz).hour % 24] += sum(h);
    }
    byHour = hours.map((bytes) => bytes / Math.max(1, past.length));
  }

  return {
    total,
    /** Bytes on the average day so far. */
    perDay: sum(total) / Math.max(1, past.length),
    busiest,
    /** The quietest finished day (today isn't over). */
    quietest,
    /** Average bytes per day for each weekday (Monday first), and how many of each there were. */
    byWeekday: weekdays.map((w, i) => ({
      day: WEEKDAYS[i],
      bytes: w.days ? w.bytes / w.days : 0,
      days: w.days,
    })),
    /** Average bytes in each hour of the box's day (0–23), or null without hourly data. */
    byHour,
    /** Days that have started (the averages are over these). */
    days: past.length,
    /** The range is a single day (charts show its hours). */
    singleDay: range.days === 1,
  };
}
