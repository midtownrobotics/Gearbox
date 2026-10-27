// Pack quantity: how many parts one unit of a product is. Orders counts, prices and budgets what
// is bought (1 pack); the Inventory app counts parts (4 wheels), so receiving multiplies by it.
// A pack can be an amount in a unit instead (a 100 ft spool is 100 "ft"), the unit Inventory
// counts it in. Units are Inventory's (@g3/worker-inventory/units): whole numbers, "" for each.

import { cleanUnit } from "@g3/worker-inventory/units";

export {
  COMMON_UNITS,
  MAX_UNIT,
  formatQuantity,
  sameUnit,
  unitName,
} from "@g3/worker-inventory/units";

export const MAX_PACK_QUANTITY = 10_000;

/** A pack quantity from a request body: a whole number from 1 to 10,000, or null. */
export function packQuantityField(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_PACK_QUANTITY
    ? value
    : null;
}

/** A pack's unit from a request body: "" for each, or null if it isn't text or is too long. */
export const packUnitField = cleanUnit;

// How vendors write it in a product's name: "PK4", "4 Pack", "10-pack", "25 pcs", "100 ct",
// "Pack of 10", "bag of 50", "set of 2".
const PATTERNS = [
  /\bpk\s?(\d{1,5})\b/i,
  /\b(\d{1,5})[\s-]?(?:pack|pk|pcs?|pieces?|count|ct)\b/i,
  /\b(?:pack|package|bag|box|set|qty\.?|quantity) of (\d{1,5})\b/i,
];

/**
 * The pack quantity a product's name suggests, or null if it doesn't say. A guess: the requester
 * is asked to check it.
 */
export function guessPackQuantity(name: string): number | null {
  for (const pattern of PATTERNS) {
    const n = Number(name.match(pattern)?.[1]);
    if (Number.isInteger(n) && n >= 2 && n <= MAX_PACK_QUANTITY) return n;
  }
  return null;
}

// An amount in a product's name: "25 ft", "100' spool", "10m", "1 kg spool", "5 lb". Inches are
// left out (names give sizes in them: '1/2" hex'), and so is a number after a decimal point or a
// slash ("1.75 mm", "1/2 lb") and "ft-lb". "m" only in lowercase: "3M" is a brand.
const AMOUNTS: [RegExp, string][] = [
  [/(?<![\d./])(\d{1,5}) ?(?:ft|feet|foot)\b(?!-)/i, "ft"],
  [/(?<![\d./])(\d{1,5})'(?![\d"'])/, "ft"],
  [/(?<![\d./])(\d{1,5}) ?(?:m|meters?|metres?)\b(?!-)/, "m"],
  [/(?<![\d./])(\d{1,5}) ?(?:kg|kilograms?)\b/i, "kg"],
  [/(?<![\d./])(\d{1,5}) ?(?:lbs?|pounds?)\b(?!-)/i, "lb"],
];

/**
 * What one of a product is, as its name says: a count ("PK4": 4 each), else an amount in a unit
 * ("25 ft spool": 25 ft), or null if it says neither. A count wins: "10 pack of 6 ft cables" is
 * ten cables. A guess, like guessPackQuantity.
 */
export function guessPack(name: string): { quantity: number; unit: string } | null {
  const count = guessPackQuantity(name);
  if (count !== null) return { quantity: count, unit: "" };
  for (const [pattern, unit] of AMOUNTS) {
    const n = Number(name.match(pattern)?.[1]);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_PACK_QUANTITY) return { quantity: n, unit };
  }
  return null;
}

/** What one part (or one of the unit) cost, from what one pack cost. */
export function pricePerPart(unitPriceCents: number | null, packQuantity: number): number | null {
  return unitPriceCents === null ? null : Math.round(unitPriceCents / Math.max(1, packQuantity));
}
