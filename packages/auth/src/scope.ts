import { type SQL, and, eq, getTableName } from "drizzle-orm";
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

/** A team's data from one app, as its export hook gives it (`GET /internal/teams/:teamId/export`). */
export type TeamExport = {
  format: "gearbox-team-export";
  version: 1;
  app: string;
  appVersion: string;
  teamId: string;
  /** When it was made (Unix seconds). */
  exportedAt: number;
  /** Rows by table name, each as the app stores it (secrets left out). */
  tables: Record<string, Record<string, unknown>[]>;
  /** What isn't in it and why (secrets, files kept elsewhere). */
  notes?: string[];
};

/**
 * Every row a team has in these tables, keyed by table name: the read side of `deleteTeamRows`,
 * for an app's export hook. `omit` names columns to leave out of a table's rows (a team's
 * encrypted secrets, a box key's hash): an export goes to the team's admin as a file.
 */
export async function exportTeamRows(
  // Any app's Drizzle database: only `select` is used.
  // biome-ignore lint/suspicious/noExplicitAny: each app's Drizzle type differs
  db: { select(): { from(table: any): { where(where: SQL): { all(): Promise<any[]> } } } },
  teamId: string,
  tables: TeamTable[],
  omit: Record<string, string[]> = {},
): Promise<TeamExport["tables"]> {
  const out: TeamExport["tables"] = {};
  for (const table of tables) {
    const name = getTableName(table as unknown as Parameters<typeof getTableName>[0]);
    const rows = (await db.select().from(table).where(inTeam(table, teamId)).all()) as Record<
      string,
      unknown
    >[];
    const left = omit[name] ?? [];
    out[name] = rows.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => !left.includes(key))),
    );
  }
  return out;
}

/** An export hook's answer: the team's rows from this app, with what's in it and what isn't. */
export function teamExport(
  manifest: { slug: string; version: string },
  teamId: string,
  tables: TeamExport["tables"],
  notes?: string[],
): TeamExport {
  return {
    format: "gearbox-team-export",
    version: 1,
    app: manifest.slug,
    appVersion: manifest.version,
    teamId,
    exportedAt: Math.floor(Date.now() / 1000),
    tables,
    ...(notes?.length ? { notes } : {}),
  };
}
