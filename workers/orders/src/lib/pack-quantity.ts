// Pack quantity: how many parts one unit of a product is. Orders counts, prices and budgets what
// is bought (1 pack); the Inventory app counts parts (4 wheels), so receiving multiplies by it.

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

/** What one part cost, from what one pack cost. */
export function pricePerPart(unitPriceCents: number | null, packQuantity: number): number | null {
  return unitPriceCents === null ? null : Math.round(unitPriceCents / Math.max(1, packQuantity));
}
