import { inTeam, withTeam } from "@g3/auth";
import { type SQL, eq, getTableColumns, notExists, sql } from "drizzle-orm";
import { type SQLiteColumn, type SQLiteTable, alias } from "drizzle-orm/sqlite-core";
import { createMiddleware } from "hono/factory";
import { type OrdersDb, createOrdersDb } from "../db";
import { appSettings, catalogCategories, catalogFamilies, catalogItems } from "../db/schema";
import type { AppEnv } from "../types";

// Every team starts with the FRCDesign parts catalog. It's kept once, under the team id "starter"
// (migration 0018, which no real team has), and a team gets its own copy the first time it needs
// its catalog. From then on the copy is the team's: its edits, prices and new parts stay with it,
// and other teams keep theirs (roadmap Phase 3: a team's edit to the catalog is that team's).

/** The team id the starter catalog is kept under. Team ids are "frc<number>". */
export const STARTER_TEAM = "starter";
/** Set once a team has its copy (also on G3's, which had the catalog before teams). */
const LOADED_KEY = "catalog_starter";

/** Teams this isolate has seen with a catalog, so the check is one read per team per isolate. */
const loaded = new Set<string>();

type TeamTable = SQLiteTable & { teamId: SQLiteColumn };

/**
 * `INSERT INTO table SELECT … FROM table WHERE team_id = 'starter' AND <where>`: the starter's rows,
 * as the team's. Values are listed in the table's column order, which the insert needs; the id is
 * left for the database to assign, and `overrides` replaces any column's value.
 */
function copyStarterRows(
  db: OrdersDb,
  table: TeamTable,
  teamId: string,
  where: SQL,
  overrides: Record<string, SQL> = {},
) {
  const columns = getTableColumns(table) as Record<string, SQLiteColumn>;
  const fields = Object.fromEntries(
    Object.entries(columns).map(([key, column]) => [
      key,
      overrides[key] ?? (key === "id" ? sql`null` : key === "teamId" ? sql`${teamId}` : column),
    ]),
  );
  return db.insert(table).select(
    db
      .select(fields)
      .from(table)
      .where(inTeam(table, STARTER_TEAM, where)) as never,
  );
}

/** Gives the team its copy of the starter catalog, once. */
export async function ensureCatalog(db: OrdersDb, teamId: string) {
  if (teamId === STARTER_TEAM || loaded.has(teamId)) return;
  const marker = db
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(inTeam(appSettings, teamId, eq(appSettings.key, LOADED_KEY)));
  if (await marker.get()) {
    loaded.add(teamId);
    return;
  }
  // The team's family with the same FRCDesign id as the starter item's family.
  const starterFamily = alias(catalogFamilies, "starter_family");
  const teamFamily = alias(catalogFamilies, "team_family");
  const familyId = db
    .select({ id: teamFamily.id })
    .from(teamFamily)
    .innerJoin(starterFamily, eq(starterFamily.sourceId, teamFamily.sourceId))
    .where(inTeam(teamFamily, teamId, eq(starterFamily.id, catalogItems.familyId)));
  // One batch, all or nothing. Every copy is conditional on the marker not being there yet, and
  // the marker goes in last, so a second request racing this one copies nothing.
  const first = notExists(marker);
  await db.batch([
    copyStarterRows(db, catalogFamilies, teamId, first),
    copyStarterRows(db, catalogItems, teamId, first, { familyId: sql`(${familyId})` }),
    copyStarterRows(db, catalogCategories, teamId, first, {
      createdAt: sql`${Date.now()}`,
    }),
    db
      .insert(appSettings)
      .values(withTeam(teamId, { key: LOADED_KEY, value: String(Date.now()) }))
      .onConflictDoNothing(),
  ]);
  loaded.add(teamId);
}

/** Makes sure the team has its catalog before the route reads it. Goes after requireAuth. */
export const catalogReady = createMiddleware<AppEnv>(async (c, next) => {
  await ensureCatalog(createOrdersDb(c.env.ORDERS_DB), c.get("teamId"));
  await next();
});
