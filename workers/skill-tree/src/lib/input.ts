// Checks for request bodies and path ids.

/** A positive integer id from a path segment, or null. */
export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The trimmed string, or null if it isn't one, is too long, or is empty when `required`. */
export function textField(value: unknown, max: number, required = false): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > max || (required && !trimmed)) return null;
  return trimmed;
}

/** A list of up to `max` distinct positive integer ids, or null. */
export function idList(value: unknown, max = 40): number[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  if (!value.every((id) => Number.isInteger(id) && id > 0)) return null;
  return [...new Set(value as number[])];
}

/** `items` in groups of at most `size`: D1 allows 100 bound parameters per statement. */
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
