import type { ItemView, StockView } from "@g3/worker-inventory";

/** A line of the main table (and of a location's contents): an entry in one place. */
export type Row = { item: ItemView; stock: StockView | null };

/**
 * An entry's rows: one for each place it has parts. With none anywhere, the row that remembers
 * where it's kept, or a bare row for an entry that has never had a place.
 */
export function rowsOf(item: ItemView): Row[] {
  const held = item.stock.filter((stock) => stock.quantity > 0);
  if (held.length > 0) return held.map((stock) => ({ item, stock }));
  return [{ item, stock: item.stock[0] ?? null }];
}
