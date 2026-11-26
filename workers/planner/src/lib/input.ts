// SPDX-License-Identifier: AGPL-3.0-only
/** The longest card title. */
export const MAX_TITLE = 200;

/** A positive integer id from a path segment, or null. */
export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A card's title, trimmed, or null if it's missing, empty or too long. */
export function parseTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_TITLE ? trimmed : null;
}

/** Today, or the day of `seconds`, in a time zone, as "YYYY-MM-DD". */
export function dayIn(timeZone: string, seconds = nowSeconds()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(seconds * 1000));
}

/**
 * A due date (or a scheduled day) from a request: a real calendar day as "YYYY-MM-DD", or null to clear it; undefined
 * when the request didn't say, and false when it said something else.
 */
export function parseDueDate(value: unknown): string | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const real =
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return real && y >= 2000 && y <= 2100 ? value : false;
}

/** Now, in Unix seconds. */
export const nowSeconds = () => Math.floor(Date.now() / 1000);
