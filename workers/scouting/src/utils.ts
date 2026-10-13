export function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function text(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export const MAX_FRC_TEAM_NUMBER = 12_000;

export function teamNumber(value: unknown, enforceMaximum = true) {
  const source =
    value && typeof value === "object"
      ? ((value as Record<string, unknown>).team_number ??
        (value as Record<string, unknown>).teamNumber ??
        (value as Record<string, unknown>).team ??
        (value as Record<string, unknown>).number)
      : value;
  const raw =
    typeof source === "number" && Number.isInteger(source) ? String(source) : text(source, 40);
  const candidate = raw.match(/\d{1,6}/)?.[0] ?? "";
  if (
    !candidate ||
    Number(candidate) < 1 ||
    (enforceMaximum && Number(candidate) > MAX_FRC_TEAM_NUMBER)
  )
    return "";
  return String(Number(candidate));
}

export function stringArray(value: unknown, maxItems = 100) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => text(item, 300))
    .filter(Boolean);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === "string" ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function nested(value: unknown, ...path: string[]) {
  let current: unknown = value;
  for (const key of path) current = record(current)[key];
  return current;
}

export function firstJsonObject(value: string) {
  const start = value.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return value.slice(start, index + 1);
  }
  return "";
}

export async function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} timed out; try a smaller image`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
