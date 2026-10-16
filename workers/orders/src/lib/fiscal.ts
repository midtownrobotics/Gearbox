// A team's fiscal year: it starts on the 1st of the team's start month (a team setting,
// lib/settings.ts), at midnight local time for whoever is looking (lib/local-time.ts). A fiscal year is named by its starting year
// (July start: 2026 = July 1, 2026 – June 30, 2027, shown as "2026–27"; January start: "2026").
// No imports, so the orders app uses this too (package export "@g3/worker-orders/fiscal").

export type FiscalCalendar = {
  /** 1–12: the month the fiscal year starts in. */
  startMonth: number;
  /** IANA time zone ("America/New_York"). */
  timeZone: string;
};

/** The year and month (1–12) a moment falls in, in a time zone. */
function localYearMonth(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    year: "numeric",
  }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month") };
}

/** How far a time zone's clock is ahead of UTC at a moment, in ms. */
function zoneOffset(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wall - Math.floor(ms / 1000) * 1000;
}

/** A wall-clock time (month 1–12) in a time zone, in ms. */
export function zonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
) {
  const wall = Date.UTC(year, month - 1, day, hour);
  // The offset at the guess, then again at the answer, in case a clock change falls between.
  const first = wall - zoneOffset(wall, timeZone);
  return wall - zoneOffset(first, timeZone);
}

/** The fiscal year a moment falls in. */
export function fiscalYearOf(ms: number, calendar: FiscalCalendar): number {
  const { year, month } = localYearMonth(ms, calendar.timeZone);
  return month >= calendar.startMonth ? year : year - 1;
}

/** [start, end) of a fiscal year in ms. */
export function fiscalRange(fiscalYear: number, calendar: FiscalCalendar): [number, number] {
  return [
    zonedTime(fiscalYear, calendar.startMonth, 1, 0, calendar.timeZone),
    zonedTime(fiscalYear + 1, calendar.startMonth, 1, 0, calendar.timeZone),
  ];
}

/** "2026–27", or "2026" when the fiscal year is the calendar year. */
export const fiscalLabel = (fiscalYear: number, startMonth: number) =>
  startMonth === 1
    ? String(fiscalYear)
    : `${fiscalYear}–${String((fiscalYear + 1) % 100).padStart(2, "0")}`;

/** Whether a string is a time zone this runtime knows. */
export function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
