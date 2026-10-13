import type { SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import * as schema from "./schema";

export const createDb = (d1: D1Database) => drizzle(d1, { schema });
export type Db = ReturnType<typeof createDb>;
export type WriteQuery = BatchItem<"sqlite">;
export const dbOf = (c: Context<AppEnv>) => createDb(c.env.SCOUTING_DB);

// Preserve the existing response projections for complex reports and settlement joins.
// Their table sources are explicitly scoped with inTeam at every call site.
export async function all<T extends Record<string, unknown>>(db: Db, query: SQL) {
  return { results: await db.all<T>(query) };
}
export async function first<T extends Record<string, unknown>>(db: Db, query: SQL) {
  return (await db.get<T>(query)) ?? null;
}
export async function batch(db: Db, queries: WriteQuery[]) {
  if (!queries.length) return [];
  return db.batch(queries as [WriteQuery, ...WriteQuery[]]);
}
