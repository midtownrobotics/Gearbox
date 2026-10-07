import { asc } from "drizzle-orm";
import type { Db } from "../db";
import { type FieldType, fields } from "../db/schema";

// The fields a team records about a part are the team's own: admins define them on the Settings
// page, and an entry's values are checked against them here.

export type FieldValue = string | number | boolean;
/** An entry's values, by field id. A field with no value is left out. */
export type FieldValues = Record<string, FieldValue>;

export type FieldView = {
  id: number;
  name: string;
  type: FieldType;
  /** A choice field's choices. */
  options: string[];
  showInTable: boolean;
};

export function parseOptions(json: string): string[] {
  try {
    const list = JSON.parse(json) as unknown;
    return Array.isArray(list) ? list.filter((o): o is string => typeof o === "string") : [];
  } catch {
    return [];
  }
}

export function parseValues(json: string): FieldValues {
  try {
    const map = JSON.parse(json) as unknown;
    return map && typeof map === "object" && !Array.isArray(map) ? (map as FieldValues) : {};
  } catch {
    return {};
  }
}

/** The team's fields, in their order. */
export async function loadFields(db: Db): Promise<FieldView[]> {
  const rows = await db.select().from(fields).orderBy(asc(fields.sortOrder), asc(fields.id)).all();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    options: parseOptions(row.options),
    showInTable: row.showInTable === 1,
  }));
}

/** One value for one field: the cleaned value, null to clear it, or what's wrong. */
function cleanValue(field: FieldView, value: unknown): FieldValue | null | { error: string } {
  if (value === null || value === undefined || value === "") return null;
  const wrong = (what: string) => ({ error: `${field.name} must be ${what}.` });
  switch (field.type) {
    case "text":
    case "paragraph": {
      if (typeof value !== "string") return wrong("text");
      const max = field.type === "text" ? 200 : 4000;
      const text = value.trim();
      if (text.length > max) return wrong(`at most ${max} characters`);
      return text || null;
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : wrong("a number");
    case "checkbox":
      return typeof value === "boolean" ? value || null : wrong("yes or no");
    case "choice":
      return typeof value === "string" && field.options.includes(value)
        ? value
        : wrong(`one of: ${field.options.join(", ")}`);
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? value
        : wrong("a date");
    case "link": {
      if (typeof value !== "string" || value.length > 2000) return wrong("a link");
      try {
        const url = new URL(value.trim());
        if (url.protocol !== "https:" && url.protocol !== "http:") return wrong("a link");
        return url.toString();
      } catch {
        return wrong("a link (starting with https://)");
      }
    }
  }
}

/**
 * Applies `input` (field id -> value; null or "" clears) on top of an entry's `current` values.
 * Gives back the new values and the names of the fields that changed, or what's wrong.
 */
export function applyValues(
  input: unknown,
  current: FieldValues,
  defs: FieldView[],
): { values: FieldValues; changed: string[] } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "values must be an object of field id to value." };
  }
  // Values of fields that have since been deleted are dropped here.
  const values: FieldValues = {};
  for (const field of defs) {
    if (current[field.id] !== undefined) values[field.id] = current[field.id];
  }
  const changed: string[] = [];
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const field = defs.find((def) => String(def.id) === key);
    if (!field) return { error: "One of those fields no longer exists. Reload and try again." };
    // Unchanged, so not checked again: a choice that has since been removed can stay as it is.
    if (raw === values[key]) continue;
    const cleaned = cleanValue(field, raw);
    if (cleaned !== null && typeof cleaned === "object") return cleaned;
    if ((values[key] ?? null) === cleaned) continue;
    if (cleaned === null) delete values[key];
    else values[key] = cleaned;
    changed.push(field.name);
  }
  return { values, changed };
}
