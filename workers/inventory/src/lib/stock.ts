import { inTeam, withTeam } from "@g3/auth";
import {
  type SQL,
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  lt,
  ne,
  not,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { type SQLiteColumn, alias } from "drizzle-orm/sqlite-core";
import type { Context } from "hono";
import type { Db } from "../db";
import { type StockStatus, itemEvents, items, robots, stock, subsystems } from "../db/schema";
import type { AppEnv } from "../types";
import { insertWhere } from "./guarded";
import { type LocationIndex, indexLocations, loadLocations, pathLabel } from "./locations";

// Stock: how many of an entry are in each place. A place is a location in storage, or a location
// plus the robot and subsystem the parts are in use on. An entry has at most one row per place.
//
// Every change is one D1 batch, which is one transaction:
//   - Taking out more than a row holds trips the table's CHECK (quantity >= 0), which fails the
//     batch, so nothing is half-done.
//   - Each later statement only acts if the row being taken from still exists (`ifRow`), and the
//     caller checks the first statement changed a row. So two people moving the same parts at
//     once can't both win, and neither can conjure parts.
//
// What happens to an emptied row: an in-use row goes away, and so does a storage row when the
// entry has another one. An entry's only storage row stays at zero, so the entry remembers where
// it lives when all of it is out on a robot, until stock arrives in storage somewhere else.

export type Place = {
  locationId: number;
  status: StockStatus;
  robotId: number | null;
  subsystemId: number | null;
};

export type Actor = { id: string; name: string };

/** Who is making the request, for the history. */
export const actorOf = (c: Context<AppEnv>): Actor => ({
  id: c.get("userId"),
  name: c.get("userDisplayName"),
});

type Batch = BatchItem<"sqlite">;

/** The stock table, or another name for it (`alias`) in a subquery about other rows of it. */
export type StockTable = Record<
  "id" | "teamId" | "itemId" | "locationId" | "status" | "robotId" | "subsystemId" | "quantity",
  SQLiteColumn
>;

/** Another name for the stock table, for a subquery about other rows of it. */
const s = alias(stock, "s");

/** `table`'s row is at `place` for the entry (robot and subsystem compared null-safely). */
const atPlace = (t: StockTable, itemId: number, place: Place) =>
  and(
    eq(t.itemId, itemId),
    eq(t.locationId, place.locationId),
    eq(t.status, place.status),
    sql`${t.robotId} IS ${place.robotId}`,
    sql`${t.subsystemId} IS ${place.subsystemId}`,
  );

/** The team's stock row `id` still exists. */
const rowExists = (db: Db, team: string, id: number) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(s)
      .where(inTeam(s, team, eq(s.id, id))),
  );

/**
 * Adds `quantity` of an entry at a place: onto its row there, or as a new row (only for an entry
 * the team has). With `ifRow`, only if that stock row still exists.
 */
export function addStock(
  db: Db,
  team: string,
  itemId: number,
  place: Place,
  quantity: number,
  now: number,
  ifRow: number | null = null,
): Batch[] {
  const guard = ifRow === null ? undefined : rowExists(db, team, ifRow);
  return [
    db
      .update(stock)
      .set({ quantity: sql`${stock.quantity} + ${quantity}`, updatedAt: now })
      .where(inTeam(stock, team, atPlace(stock, itemId, place), guard)),
    insertWhere(
      db,
      stock,
      {
        // Just the place: callers may pass a whole stock row as one.
        locationId: place.locationId,
        status: place.status,
        robotId: place.robotId,
        subsystemId: place.subsystemId,
        teamId: team,
        itemId,
        quantity,
        updatedAt: now,
      },
      items,
      inTeam(
        items,
        team,
        eq(items.id, itemId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(s)
            .where(inTeam(s, team, atPlace(s, itemId, place))),
        ),
        guard,
      ),
    ),
  ];
}

/**
 * After stock arrives in storage at a location: the entry's empty storage rows elsewhere have done
 * their job, and go. Runs last in a batch, after anything that depends on the row taken from, and
 * does nothing if nothing arrived.
 */
export function tidyStorage(db: Db, team: string, itemId: number, keepLocationId: number) {
  return db.delete(stock).where(
    inTeam(
      stock,
      team,
      eq(stock.itemId, itemId),
      eq(stock.status, "storage"),
      eq(stock.quantity, 0),
      ne(stock.locationId, keepLocationId),
      exists(
        db
          .select({ one: sql`1` })
          .from(s)
          .where(
            inTeam(
              s,
              team,
              eq(s.itemId, itemId),
              eq(s.status, "storage"),
              eq(s.locationId, keepLocationId),
            ),
          ),
      ),
    ),
  );
}

/**
 * Fails the batch it's in unless `exists` finds a row: for a change that must not happen at all
 * if what it's about has gone. It tries to add a history line with no action, which can't be
 * made, against `anchorItemId`, an entry of the team's that certainly exists.
 */
export function mustExist(db: Db, team: string, anchorItemId: number, found: SQL) {
  return insertWhere(
    db,
    itemEvents,
    { teamId: team, itemId: anchorItemId, userId: "", userName: "", createdAt: 0 },
    items,
    inTeam(items, team, eq(items.id, anchorItemId), not(found)),
  );
}

/** Takes `quantity` out of a stock row. More than it holds fails the whole batch. */
export function takeStock(db: Db, team: string, stockId: number, quantity: number, now: number) {
  return db
    .update(stock)
    .set({ quantity: sql`${stock.quantity} - ${quantity}`, updatedAt: now })
    .where(inTeam(stock, team, eq(stock.id, stockId)));
}

/**
 * Removes a row once it's empty: always for parts in use. For storage, when `evenStorage` or when
 * the entry has another storage row; its only one stays, at zero.
 */
export function dropIfEmpty(db: Db, team: string, stockId: number, evenStorage: boolean) {
  const anotherStorageRow = exists(
    db
      .select({ one: sql`1` })
      .from(s)
      .where(
        inTeam(s, team, eq(s.itemId, stock.itemId), eq(s.status, "storage"), ne(s.id, stock.id)),
      ),
  );
  return db
    .delete(stock)
    .where(
      inTeam(
        stock,
        team,
        eq(stock.id, stockId),
        eq(stock.quantity, 0),
        evenStorage ? undefined : or(eq(stock.status, "in_use"), anotherStorageRow),
      ),
    );
}

/** A line in an entry's history. With `ifRow`, only if that stock row still exists. */
export function logEvent(
  db: Db,
  team: string,
  itemId: number,
  action: string,
  note: string | null,
  by: Actor,
  now: number,
  ifRow: number | null = null,
  ref: string | null = null,
): Batch {
  const row = { itemId, action, note, ref, userId: by.id, userName: by.name, createdAt: now };
  if (ifRow === null) return db.insert(itemEvents).values(withTeam(team, row));
  return insertWhere(
    db,
    itemEvents,
    { ...row, teamId: team },
    stock,
    inTeam(stock, team, eq(stock.id, ifRow)),
  );
}

/** Runs statements as one D1 batch: all of them, or (if any fails) none. */
export async function batch(db: Db, statements: Batch[]) {
  const [first, ...rest] = statements;
  return first ? db.batch([first, ...rest]) : [];
}

export type StockOutcome = "ok" | "gone" | "short";

/** Why a batch failed, when it's one of the two ways a stock change is refused. */
export function refusal(err: unknown): Exclude<StockOutcome, "ok"> | null {
  // Drizzle wraps D1's error; the constraint's name is in the cause.
  const cause = (err as { cause?: unknown } | null)?.cause;
  const message = String(err instanceof Error ? `${err.message} ${cause ?? ""}` : err);
  if (message.includes("CHECK constraint")) return "short";
  if (message.includes("NOT NULL constraint")) return "gone";
  return null;
}

/** How many rows a batch's statement changed. */
const changes = (result: unknown) =>
  (result as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;

/**
 * Runs a change whose first statement touches the stock row it's about. "short" when there
 * weren't enough there (nothing changed); "gone" when the row no longer exists.
 */
export async function runStockChange(db: Db, statements: Batch[]): Promise<StockOutcome> {
  try {
    const [first, ...rest] = statements;
    if (!first) return "gone";
    const results = await db.batch([first, ...rest]);
    return changes(results[0]) === 1 ? "ok" : "gone";
  } catch (err) {
    const why = refusal(err);
    if (why) return why;
    throw err;
  }
}

export const STOCK_ERRORS = {
  gone: "That row has changed since you loaded the page. Reload and try again.",
  short: "There aren't that many there anymore. Reload and try again.",
} as const;

/** What ids mean, for checking them and for writing history lines. */
export type Names = {
  locations: LocationIndex;
  robots: Map<number, string>;
  subsystems: Map<number, string>;
};

export async function loadNames(db: Db, team: string): Promise<Names> {
  const [locationRows, robotRows, subsystemRows] = await Promise.all([
    loadLocations(db, team),
    db
      .select()
      .from(robots)
      .where(inTeam(robots, team))
      .orderBy(asc(robots.sortOrder), asc(robots.id))
      .all(),
    db
      .select()
      .from(subsystems)
      .where(inTeam(subsystems, team))
      .orderBy(asc(subsystems.sortOrder), asc(subsystems.id))
      .all(),
  ]);
  return {
    locations: indexLocations(locationRows),
    robots: new Map(robotRows.map((row) => [row.id, row.name])),
    subsystems: new Map(subsystemRows.map((row) => [row.id, row.name])),
  };
}

/** "Dungeon › A1", or "Pit cart, on Comp Bot (Intake)" for parts in use. */
export function describePlace(place: Place, names: Names): string {
  const where = pathLabel(place.locationId, names.locations.byId) || "an unknown location";
  if (place.status === "storage") return where;
  const robot = (place.robotId !== null && names.robots.get(place.robotId)) || "a robot";
  const subsystem =
    (place.subsystemId !== null && names.subsystems.get(place.subsystemId)) || "a subsystem";
  return `${where}, on ${robot} (${subsystem})`;
}

/**
 * The history line for parts going between storage and use. When they stay at one location, it's
 * said once: "6 in Dungeon › A1, onto Comp Bot (Intake)."
 */
export function transferNote(quantity: number, from: Place, to: Place, names: Names): string {
  if (from.locationId !== to.locationId || from.status === to.status) {
    return `${quantity} from ${describePlace(from, names)} to ${describePlace(to, names)}.`;
  }
  const where = describePlace({ ...from, status: "storage" }, names);
  const onRobot = (place: Place) =>
    describePlace(place, names).slice(where.length + ", on ".length);
  return to.status === "in_use"
    ? `${quantity} in ${where}, onto ${onRobot(to)}.`
    : `${quantity} in ${where}, off ${onRobot(from)}.`;
}

/** Null if the place is one that exists; else why not. */
export function placeProblem(place: Place, names: Names): string | null {
  if (!names.locations.byId.has(place.locationId)) return "Pick a location.";
  if (place.status === "storage") {
    return place.robotId === null && place.subsystemId === null
      ? null
      : "Parts in storage aren't on a robot.";
  }
  if (place.robotId === null || !names.robots.has(place.robotId)) return "Pick a robot.";
  if (place.subsystemId === null || !names.subsystems.has(place.subsystemId)) {
    return "Pick a subsystem.";
  }
  return null;
}

/**
 * Moves everything kept directly in one location to another: every row, whole. Where an entry
 * already has a row in the same state at the new place, the two become one. Each entry gets a line
 * in its history. One batch, so it all moves or none of it does.
 */
export async function moveLocationContents(
  db: Db,
  team: string,
  from: number,
  to: number,
  names: Names,
  by: Actor,
): Promise<{ entries: number; parts: number }> {
  const rows = await db
    .select({
      itemId: stock.itemId,
      status: stock.status,
      robotId: stock.robotId,
      subsystemId: stock.subsystemId,
      quantity: stock.quantity,
    })
    .from(stock)
    .where(inTeam(stock, team, eq(stock.locationId, from)))
    .orderBy(asc(stock.id))
    .all();
  if (rows.length === 0) return { entries: 0, parts: 0 };

  const now = Date.now();
  const t = alias(stock, "t");
  // A row of `other` at `at` that's the same entry, in the same state, as the stock row.
  const twin = (other: StockTable, at: number): SQL =>
    inTeam(
      other,
      team,
      eq(other.locationId, at),
      eq(other.itemId, stock.itemId),
      eq(other.status, stock.status),
      sql`${other.robotId} IS ${stock.robotId}`,
      sql`${other.subsystemId} IS ${stock.subsystemId}`,
    );
  await db.batch([
    // Where the entry is already at the new place, the quantities add up...
    db
      .update(stock)
      .set({
        updatedAt: now,
        quantity: sql`${stock.quantity} + (${db
          .select({ quantity: s.quantity })
          .from(s)
          .where(inTeam(s, team, twin(s, from)))})`,
      })
      .where(
        inTeam(
          stock,
          team,
          eq(stock.locationId, to),
          exists(
            db
              .select({ one: sql`1` })
              .from(s)
              .where(inTeam(s, team, twin(s, from))),
          ),
        ),
      ),
    db.delete(stock).where(
      inTeam(
        stock,
        team,
        eq(stock.locationId, from),
        exists(
          db
            .select({ one: sql`1` })
            .from(t)
            .where(inTeam(t, team, twin(t, to))),
        ),
      ),
    ),
    // ...and everything else just changes place.
    db
      .update(stock)
      .set({ locationId: to, updatedAt: now })
      .where(inTeam(stock, team, eq(stock.locationId, from))),
    // An entry that now has parts in storage there doesn't need an empty row left elsewhere.
    db
      .delete(stock)
      .where(
        inTeam(
          stock,
          team,
          eq(stock.status, "storage"),
          eq(stock.quantity, 0),
          inArray(
            stock.itemId,
            db
              .select({ itemId: t.itemId })
              .from(t)
              .where(inTeam(t, team, eq(t.locationId, to))),
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(s)
              .where(
                inTeam(
                  s,
                  team,
                  eq(s.itemId, stock.itemId),
                  eq(s.status, "storage"),
                  ne(s.id, stock.id),
                  or(gt(s.quantity, 0), lt(s.id, stock.id)),
                ),
              ),
          ),
        ),
      ),
    ...rows.map((row) => {
      const place = { ...row, locationId: from };
      const there = describePlace({ ...place, locationId: to }, names);
      return logEvent(
        db,
        team,
        row.itemId,
        "moved",
        row.quantity > 0
          ? `${row.quantity} from ${describePlace(place, names)} to ${there}.`
          : `Now kept in ${there}.`,
        by,
        now,
      );
    }),
  ]);
  return {
    entries: new Set(rows.map((row) => row.itemId)).size,
    parts: rows.reduce((sum, row) => sum + row.quantity, 0),
  };
}
