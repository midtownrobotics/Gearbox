import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

/** D1 binds at most this many values in one statement. */
export const D1_MAX_PARAMS = 100;

/**
 * How many rows one insert into `table` can carry. A Drizzle insert binds up to one value per
 * column for each row (defaults too), so the count follows the table: adding a column can't push a
 * batch over D1's limit, as a hand-counted constant did when tables gained team_id.
 */
export const rowsPerInsert = (table: SQLiteTable) =>
  Math.floor(D1_MAX_PARAMS / Object.keys(getTableColumns(table)).length);

/** `items` in groups of `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
