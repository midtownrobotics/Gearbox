import { type SQL, getTableColumns, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "../db";

/**
 * An insert that only happens when `where` finds a row of `source`: `INSERT INTO table SELECT
 * <values> FROM source WHERE …`. It's how a statement in a batch says "only if that row still
 * exists" (or, with a value a column can't take, "fail the whole batch unless…"). The values
 * are listed in the table's column order, which the insert needs; a column not in `row` is null
 * (the id, so it's assigned).
 */
export function insertWhere<T extends SQLiteTable>(
  db: Db,
  table: T,
  row: Record<string, unknown>,
  source: SQLiteTable,
  where: SQL | undefined,
) {
  const fields = Object.fromEntries(
    Object.keys(getTableColumns(table)).map((key) => [
      key,
      row[key] === undefined || row[key] === null ? sql`null` : sql`${row[key]}`,
    ]),
  );
  return db.insert(table).select(db.select(fields).from(source).where(where) as never);
}
