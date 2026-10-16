// Checks for request bodies and path ids.

/** A positive integer id from a path segment or a body, or null. */
export function parseId(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/** The trimmed string, or null if it isn't one, is too long, or is empty when `required`. */
export function textField(value: unknown, max: number, required = false): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > max || (required && !trimmed)) return null;
  return trimmed;
}

/** A whole number from 0 (or `min`) to a million, or null. */
export function quantityField(value: unknown, min = 0): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= 1_000_000
    ? value
    : null;
}

/** `items` in groups of at most `size`: D1 allows 100 bound parameters per statement. */
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Whether two names are the same to a person: ignoring case and spaces at the ends. */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
