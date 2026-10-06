/** "$12.50" from 1250 cents; "—" when unknown. */
export function formatCents(cents: number | null | undefined, currency = "USD"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** Cents from a dollars string ("12.5" → 1250); null when empty, NaN when invalid. */
export function parseDollars(value: string): number | null {
  const trimmed = value.replace(/[$,\s]/g, "");
  if (!trimmed) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return Number.NaN;
  return Math.round(Number(trimmed) * 100);
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const DAY_MS = 86_400_000;

/** A date input's "YYYY-MM-DD" as midday Eastern that day (never shifts across US time zones). */
export function dateInputToMs(value: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 16) : null;
}

/** The reverse, for prefilling a date input. */
export function msToDateInput(ms: number | null): string {
  if (ms === null) return "";
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Midnight today, Eastern. */
export function startOfToday(): number {
  return (dateInputToMs(msToDateInput(Date.now())) as number) - 16 * 3_600_000;
}

/**
 * When an order must be placed to arrive by `needBy`: need-by minus the vendor's lead time and
 * shipping days. Null without a need-by date.
 */
export function placeBy(
  needBy: number | null,
  vendor: { leadTimeDays: number | null; shippingDays: number | null } | undefined,
): number | null {
  if (needBy === null) return null;
  return needBy - ((vendor?.leadTimeDays ?? 0) + (vendor?.shippingDays ?? 0)) * DAY_MS;
}
