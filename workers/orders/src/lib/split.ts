// How an order's money is divided between budget categories. No imports, so the orders app uses
// the same code to preview an order (package export "@g3/worker-orders/split").

/**
 * Splits `totalCents` across weights in proportion (evenly when every weight is 0), so the parts
 * add up to exactly the total. The remainder from rounding goes to the last part.
 */
export function splitCost(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const w = weights.some((x) => x > 0) ? weights : weights.map(() => 1);
  const sum = w.reduce((a, b) => a + b, 0);
  const shares = w.map((x) => Math.floor((totalCents * x) / sum));
  shares[shares.length - 1] += totalCents - shares.reduce((a, b) => a + b, 0);
  return shares;
}

export type OrderLine = {
  categoryId: number;
  quantity: number;
  unitPriceCents: number | null;
  lineTotalCents?: number | null;
};
export type CategoryCharge = { items: number; shipping: number; tax: number };

/** A line's total: its exact total when one was recorded (imports), else quantity × unit price. */
export const lineTotal = (l: {
  quantity: number;
  unitPriceCents: number | null;
  lineTotalCents?: number | null;
}) => l.lineTotalCents ?? (l.unitPriceCents ?? 0) * l.quantity;

/**
 * What one vendor order charges each budget category: its items, plus shipping and tax split
 * across the categories in proportion to their item cost. Categories in id order, so the split
 * (and its rounding) is the same every time.
 */
export function chargesByCategory(
  lines: OrderLine[],
  shippingCents: number,
  taxCents: number,
): Map<number, CategoryCharge> {
  const items = new Map<number, number>();
  for (const l of lines) items.set(l.categoryId, (items.get(l.categoryId) ?? 0) + lineTotal(l));
  const ids = [...items.keys()].sort((a, b) => a - b);
  const weights = ids.map((id) => items.get(id) ?? 0);
  const shipping = splitCost(shippingCents, weights);
  const tax = splitCost(taxCents, weights);
  return new Map(
    ids.map((id, i) => [id, { items: items.get(id) ?? 0, shipping: shipping[i], tax: tax[i] }]),
  );
}
