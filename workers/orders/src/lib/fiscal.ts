// Fiscal years run July–June, Eastern time. A fiscal year is named by its starting year
// (2026 = July 1, 2026 – June 30, 2027) and shown as "2026–27". No imports, so the orders app
// uses this too (package export "@g3/worker-orders/fiscal").

const ZONE = "America/New_York";

/** The fiscal year a moment falls in. */
export function fiscalYearOf(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    month: "numeric",
    year: "numeric",
  }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get("month") >= 7 ? get("year") : get("year") - 1;
}

/** [start, end) of a fiscal year in ms: midnight July 1 Eastern (always EDT, UTC−4). */
export function fiscalRange(fiscalYear: number): [number, number] {
  return [Date.UTC(fiscalYear, 6, 1, 4), Date.UTC(fiscalYear + 1, 6, 1, 4)];
}

/** "2026–27". */
export const fiscalLabel = (fiscalYear: number) =>
  `${fiscalYear}–${String((fiscalYear + 1) % 100).padStart(2, "0")}`;
