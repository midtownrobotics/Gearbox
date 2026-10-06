import { and, gte, inArray, isNotNull, lt } from "drizzle-orm";
import type { OrdersDb } from "../db";
import { orderCharges, orderRequests, vendorOrders } from "../db/schema";
import { fiscalRange } from "./fiscal";
import { type OrderLine, chargesByCategory, lineTotal } from "./split";

export {
  type CategoryCharge,
  chargesByCategory,
  lineTotal,
  type OrderLine,
  splitCost,
} from "./split";

export type Charge = { kind: string; categoryId: number; cents: number };

/**
 * An order's fee rows per category: the stored ones (new orders store their split; imports keep
 * the sheet's allocation), or for older orders, shipping and tax split by item cost.
 */
export function orderFees(
  order: { shippingCents: number; taxCents: number },
  lines: OrderLine[],
  stored: Charge[],
): Charge[] {
  if (stored.length > 0) return stored;
  return [...chargesByCategory(lines, order.shippingCents, order.taxCents)].flatMap(
    ([categoryId, c]) => [
      { kind: "Shipping", categoryId, cents: c.shipping },
      { kind: "Tax", categoryId, cents: c.tax },
    ],
  );
}

/**
 * Money actually spent per category: only placed orders, at the final quantity and price the
 * orderer entered (or the sheet's exact totals for imports), plus each category's fees.
 */
export async function spentByCategory(
  db: OrdersDb,
  fiscalYear: number,
): Promise<Map<number, number>> {
  const [from, to] = fiscalRange(fiscalYear);
  const [orders, lines, charges] = await Promise.all([
    // An order counts in the fiscal year it was placed.
    db
      .select()
      .from(vendorOrders)
      .where(and(gte(vendorOrders.placedAt, from), lt(vendorOrders.placedAt, to)))
      .all(),
    db
      .select({
        orderId: orderRequests.orderId,
        categoryId: orderRequests.categoryId,
        quantity: orderRequests.quantity,
        unitPriceCents: orderRequests.unitPriceCents,
        lineTotalCents: orderRequests.lineTotalCents,
      })
      .from(orderRequests)
      .where(
        and(
          isNotNull(orderRequests.orderId),
          inArray(orderRequests.status, ["ordered", "received"]),
        ),
      )
      .all(),
    db.select().from(orderCharges).all(),
  ]);
  const spent = new Map<number, number>();
  const add = (categoryId: number, cents: number) =>
    spent.set(categoryId, (spent.get(categoryId) ?? 0) + cents);
  for (const order of orders) {
    const mine = lines.filter((l) => l.orderId === order.id);
    if (mine.length === 0) continue;
    for (const l of mine) add(l.categoryId, lineTotal(l));
    const stored = charges.filter((c) => c.orderId === order.id);
    for (const fee of orderFees(order, mine, stored)) add(fee.categoryId, fee.cents);
  }
  return spent;
}
