// Billing cycles, daily charts, "until midnight" grants and daily rollups use local days: the
// local time of the team's box (it's in the shop), which the agent reports with each upload
// (edge_status.time_zone; UTC until a box has said). Every function takes that zone.

export const HOUR = 3600;
export const DAY = 86400;

/** Before a box reports its zone. */
export const DEFAULT_TIME_ZONE = "UTC";

/** Whether a string is a time zone this runtime knows. */
export function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Local calendar parts for a unix timestamp (seconds). Month is 1-12. */
export function localParts(ts: number, tz: string) {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(new Date(ts * 1000))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Local time minus UTC, in seconds, at the given instant. */
export function offsetAt(ts: number, tz: string) {
  const p = localParts(ts, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
  return asUtc - ts;
}

/** Unix timestamp of local midnight on the given date (month 1-12; overflow is normalized). */
export function localMidnight(year: number, month: number, day: number, tz: string) {
  const guess = Date.UTC(year, month - 1, day) / 1000;
  // Re-check the offset at the candidate so DST transitions resolve correctly.
  const first = guess - offsetAt(guess, tz);
  return guess - offsetAt(first, tz);
}

/**
 * The zone's standard (winter) offset in a year: the smaller of January's and July's, since
 * daylight saving only ever adds. Daily rollups use it all year, so a day's bucket never moves.
 */
export function standardOffset(ts: number, tz: string) {
  const { year } = localParts(ts, tz);
  return Math.min(
    offsetAt(Date.UTC(year, 0, 1) / 1000, tz),
    offsetAt(Date.UTC(year, 6, 1) / 1000, tz),
  );
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "YYYY-MM-DD" for the local day containing ts. */
export function localDayKey(ts: number, tz: string) {
  const p = localParts(ts, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * The billing cycle containing `now`. Cycles start at local midnight on
 * `startDay` of each month, clamped to the month's length (e.g. 31 → Feb 28).
 */
export function billingCycle(now: number, startDay: number, tz: string) {
  const startOf = (year: number, month: number) => {
    const y = year + Math.floor((month - 1) / 12);
    const m = ((((month - 1) % 12) + 12) % 12) + 1;
    return localMidnight(y, m, Math.min(startDay, daysInMonth(y, m)), tz);
  };
  const p = localParts(now, tz);
  let start = startOf(p.year, p.month);
  let month = p.month;
  if (start > now) {
    month -= 1;
    start = startOf(p.year, month);
  }
  return { start, end: startOf(p.year, month + 1) };
}

/** Local day keys from start (inclusive) to end (exclusive). */
export function localDayKeys(start: number, end: number, tz: string) {
  const keys: string[] = [];
  const p = localParts(start, tz);
  for (let d = 0; ; d++) {
    const ts = localMidnight(p.year, p.month, p.day + d, tz);
    if (ts >= end) break;
    keys.push(localDayKey(ts, tz));
  }
  return keys;
}
