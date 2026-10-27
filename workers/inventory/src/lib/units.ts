// What a quantity counts: an entry's unit ("ft", "kg", "sheet"), or "" for one of each. Quantities
// are whole numbers in every unit, so a team that needs part of one counts in a smaller unit (in,
// not ft). A unit is the team's own text; the suggestions are only a start. Orders uses this for
// a pack's unit too. Exported as "@g3/worker-inventory/units"; keep it dependency-free.

export const MAX_UNIT = 20;

/** Offered when a unit is typed, after the team's own. */
export const COMMON_UNITS = [
  "each",
  "ft",
  "in",
  "mm",
  "m",
  "g",
  "kg",
  "lb",
  "oz",
  "sheet",
  "roll",
  "set",
] as const;

/** Units that mean one of each, saved as "". */
const EACH = new Set(["each", "ea", "ea.", "pc", "pcs", "piece", "pieces", "part", "parts"]);

/**
 * A unit from a request body: trimmed, "" for each (also for nothing or "each"), or null if it
 * isn't text or is too long.
 */
export function cleanUnit(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const unit = value.trim().replace(/\s+/g, " ");
  if (unit.length > MAX_UNIT) return null;
  return EACH.has(unit.toLowerCase()) ? "" : unit;
}

/** Whether two units are the same to a person: ignoring case and spaces at the ends. */
export const sameUnit = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "each" for "", else the unit. */
export const unitName = (unit: string) => unit || "each";

// Words that read wrong after a number other than 1 ("3 sheet"). Abbreviations (ft, kg) and
// anything else a team types stay as they are.
const PLURALS: Record<string, string> = {
  bag: "bags",
  bottle: "bottles",
  box: "boxes",
  can: "cans",
  foot: "feet",
  gram: "grams",
  inch: "inches",
  kilogram: "kilograms",
  length: "lengths",
  meter: "meters",
  ounce: "ounces",
  pack: "packs",
  pair: "pairs",
  pound: "pounds",
  roll: "rolls",
  set: "sets",
  sheet: "sheets",
  spool: "spools",
  stick: "sticks",
  tube: "tubes",
  yard: "yards",
};

/** The unit as it reads after `n`: "sheets" after 3, "ft" after anything. */
export function unitAfter(n: number, unit: string): string {
  if (n === 1) return unit;
  return PLURALS[unit] ?? PLURALS[unit.toLowerCase()] ?? unit;
}

/** "12 ft", "3 sheets", or "12" for each. */
export const formatQuantity = (n: number, unit: string) =>
  unit ? `${n} ${unitAfter(n, unit)}` : String(n);
