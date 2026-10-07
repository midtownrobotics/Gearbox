import { type SQL, and, eq } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

// The team-scoped helpers every query on a team's table goes through (roadmap Phase 3). A team
// table is one with a `teamId` column; the tenancy lint (scripts/tenancy-lint.ts) rejects a query
// on one that doesn't use these, so a forgotten team filter fails CI instead of leaking a row.

type TeamTable = { teamId: SQLiteColumn };

/** A `where` for a team's rows: the team, and any other conditions. */
export function inTeam(table: TeamTable, teamId: string, ...conditions: (SQL | undefined)[]) {
  return and(eq(table.teamId, teamId), ...conditions) as SQL;
}

/** Values for an insert into a team table, with the team filled in. */
// The array form goes first: an array is an object too, so it would match the single-row form.
export function withTeam<T extends object>(teamId: string, values: T[]): (T & { teamId: string })[];
export function withTeam<T extends object>(teamId: string, values: T): T & { teamId: string };
export function withTeam<T extends object>(teamId: string, values: T | T[]) {
  return Array.isArray(values) ? values.map((v) => ({ ...v, teamId })) : { ...values, teamId };
}

/**
 * Deletes every row a team has in these tables, in one all-or-nothing batch, in the order given
 * (children before the rows they point at). For an app's `DELETE /internal/teams/:teamId`, which
 * the platform calls when an operator deletes a team.
 */
export async function deleteTeamRows(
  // Any app's Drizzle database: only `delete` and `batch` are used.
  // biome-ignore lint/suspicious/noExplicitAny: each app's Drizzle type differs
  db: { delete(table: any): { where(where: SQL): unknown }; batch(queries: any): Promise<unknown> },
  teamId: string,
  tables: TeamTable[],
) {
  const [first, ...rest] = tables.map((table) => db.delete(table).where(inTeam(table, teamId)));
  if (first) await db.batch([first, ...rest]);
}
