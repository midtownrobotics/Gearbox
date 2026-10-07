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
export function withTeam<T extends object>(teamId: string, values: T): T & { teamId: string };
export function withTeam<T extends object>(teamId: string, values: T[]): (T & { teamId: string })[];
export function withTeam<T extends object>(teamId: string, values: T | T[]) {
  return Array.isArray(values) ? values.map((v) => ({ ...v, teamId })) : { ...values, teamId };
}
