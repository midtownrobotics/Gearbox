// SPDX-License-Identifier: AGPL-3.0-only
import { type SQL, and, eq, getTableColumns, getTableName, sql } from "drizzle-orm";
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

/**
 * Moves every row a team has in these tables to another team id, in one all-or-nothing batch: for
 * an app's `POST /internal/teams/:teamId/move { to }`, which the platform calls when a team changes
 * program ("frc12345" → "ftc12345"). Foreign keys are checked at the end of the batch, so a table
 * whose rows point at another one by (team, id) can go in any order. Running it again moves
 * whatever is left (nothing, after a move that finished).
 */
export async function moveTeamRows(
  // Any app's Drizzle database: only `update`, `run` and `batch` are used.
  db: {
    // biome-ignore lint/suspicious/noExplicitAny: each app's Drizzle type differs
    update(table: any): { set(values: { teamId: string }): { where(where: SQL): unknown } };
    run(query: SQL): unknown;
    // biome-ignore lint/suspicious/noExplicitAny: each app's Drizzle type differs
    batch(queries: any): Promise<unknown>;
  },
  from: string,
  to: string,
  tables: TeamTable[],
  /**
   * Columns holding the keys of the team's files, renamed from one prefix to the other in the same
   * batch (the files themselves move with moveR2Prefix).
   */
  keys?: { columns: SQLiteColumn[]; from: string; to: string },
) {
  if (tables.length === 0 || from === to) return;
  const renamed = (keys?.columns ?? []).map((column) => {
    const table = (column as unknown as { table: TeamTable }).table;
    // `set` takes the table's own names for its columns (r2Key, not r2_key).
    const name = Object.entries(
      getTableColumns(table as unknown as Parameters<typeof getTableColumns>[0]),
    ).find(([, c]) => c === column)?.[0];
    if (!name) throw new Error(`moveTeamRows: ${column.name} isn't in its table`);
    return db
      .update(table)
      .set({
        [name]: sql`${keys?.to} || substr(${column}, ${(keys?.from.length ?? 0) + 1})`,
      } as unknown as { teamId: string })
      .where(inTeam(table, from, sql`substr(${column}, 1, ${keys?.from.length}) = ${keys?.from}`));
  });
  await db.batch([
    db.run(sql`PRAGMA defer_foreign_keys = on`),
    // The keys first, while the rows are still the old team's.
    ...renamed,
    ...tables.map((table) => db.update(table).set({ teamId: to }).where(inTeam(table, from))),
  ]);
}

/**
 * The team id a move is to (`POST /internal/teams/:teamId/move { to }`), or null when the body
 * doesn't name one, or names the team it's from.
 */
export async function moveTarget(request: Request, from: string): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as { to?: unknown } | null;
  const to = body?.to;
  return typeof to === "string" && /^(frc|ftc)[1-9]\d*$/.test(to) && to !== from ? to : null;
}

/**
 * Moves every file under one R2 prefix to another (a team's files, on a move: see moveTeamRows),
 * at most `limit` at a time: each is copied, then deleted. True when nothing is left under `from`;
 * false when there's more, for the platform to call the move again.
 */
export async function moveR2Prefix(
  bucket: R2Bucket,
  from: string,
  to: string,
  limit = 200,
): Promise<boolean> {
  if (from === to) return true;
  const page = await bucket.list({ prefix: from, limit });
  for (const listed of page.objects) {
    const object = await bucket.get(listed.key);
    if (object) {
      await bucket.put(`${to}${listed.key.slice(from.length)}`, object.body, {
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
      });
    }
    await bucket.delete(listed.key);
  }
  return !page.truncated;
}

/**
 * A key's new name after its team's files moved from one prefix to another (moveR2Prefix), for
 * the columns that keep a file's key. Any other key stays as it is.
 */
export function movedKey(key: string, from: string, to: string): string {
  return key.startsWith(from) ? `${to}${key.slice(from.length)}` : key;
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
