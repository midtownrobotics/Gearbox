import { asc } from "drizzle-orm";
import type { Context } from "hono";
import type { Db } from "../db";
import { type StockStatus, robots, subsystems } from "../db/schema";
import type { AppEnv } from "../types";
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

const SAME_PLACE =
  "item_id = ?1 AND location_id = ?2 AND status = ?3 AND robot_id IS ?4 AND subsystem_id IS ?5";

/**
 * Adds `quantity` of an entry at a place: onto its row there, or as a new row. With `ifRow`, only
 * if that stock row still exists.
 */
export function addStock(
  d1: D1Database,
  itemId: number,
  place: Place,
  quantity: number,
  now: number,
  ifRow: number | null = null,
): D1PreparedStatement[] {
  const guard = "(?8 IS NULL OR EXISTS (SELECT 1 FROM stock WHERE id = ?8))";
  const bind = [
    itemId,
    place.locationId,
    place.status,
    place.robotId,
    place.subsystemId,
    quantity,
    now,
    ifRow,
  ];
  return [
    d1
      .prepare(
        `UPDATE stock SET quantity = quantity + ?6, updated_at = ?7 WHERE ${SAME_PLACE} AND ${guard}`,
      )
      .bind(...bind),
    d1
      .prepare(
        `INSERT INTO stock (item_id, location_id, status, robot_id, subsystem_id, quantity, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
         WHERE NOT EXISTS (SELECT 1 FROM stock WHERE ${SAME_PLACE}) AND ${guard}`,
      )
      .bind(...bind),
  ];
}

/**
 * After stock arrives in storage at a location: the entry's empty storage rows elsewhere have done
 * their job, and go. Runs last in a batch, after anything that depends on the row taken from, and
 * does nothing if nothing arrived.
 */
export function tidyStorage(d1: D1Database, itemId: number, keepLocationId: number) {
  return d1
    .prepare(
      `DELETE FROM stock
       WHERE item_id = ?1 AND status = 'storage' AND quantity = 0 AND location_id <> ?2
         AND EXISTS (SELECT 1 FROM stock s
                     WHERE s.item_id = ?1 AND s.status = 'storage' AND s.location_id = ?2)`,
    )
    .bind(itemId, keepLocationId);
}

/**
 * Fails the batch it's in unless a row exists: `from` is the rest of "SELECT 1 FROM". For a change
 * that must not happen at all if what it's about has gone. (The insert it tries can't be made.)
 */
export function mustExist(d1: D1Database, from: string, ...binds: unknown[]) {
  return d1
    .prepare(
      `INSERT INTO item_events (item_id, action, user_id, user_name, created_at)
       SELECT 0, NULL, '', '', 0 WHERE NOT EXISTS (SELECT 1 FROM ${from})`,
    )
    .bind(...binds);
}

/** Takes `quantity` out of a stock row. More than it holds fails the whole batch. */
export function takeStock(d1: D1Database, stockId: number, quantity: number, now: number) {
  return d1
    .prepare("UPDATE stock SET quantity = quantity - ?2, updated_at = ?3 WHERE id = ?1")
    .bind(stockId, quantity, now);
}

/**
 * Removes a row once it's empty: always for parts in use. For storage, when `evenStorage` or when
 * the entry has another storage row; its only one stays, at zero.
 */
export function dropIfEmpty(d1: D1Database, stockId: number, evenStorage: boolean) {
  return d1
    .prepare(
      `DELETE FROM stock
       WHERE id = ?1 AND quantity = 0
         AND (status = 'in_use' OR ?2 = 1
              OR EXISTS (SELECT 1 FROM stock s
                         WHERE s.item_id = stock.item_id AND s.status = 'storage' AND s.id <> stock.id))`,
    )
    .bind(stockId, evenStorage ? 1 : 0);
}

/** A line in an entry's history. With `ifRow`, only if that stock row still exists. */
export function logEvent(
  d1: D1Database,
  itemId: number,
  action: string,
  note: string | null,
  by: Actor,
  now: number,
  ifRow: number | null = null,
  ref: string | null = null,
) {
  return d1
    .prepare(
      `INSERT INTO item_events (item_id, action, note, ref, user_id, user_name, created_at)
       SELECT ?1, ?2, ?3, ?8, ?4, ?5, ?6
       WHERE ?7 IS NULL OR EXISTS (SELECT 1 FROM stock WHERE id = ?7)`,
    )
    .bind(itemId, action, note, by.id, by.name, now, ifRow, ref);
}

export type StockOutcome = "ok" | "gone" | "short";

/** Why a batch failed, when it's one of the two ways a stock change is refused. */
export function refusal(err: unknown): Exclude<StockOutcome, "ok"> | null {
  const message = String(err instanceof Error ? err.message : err);
  if (message.includes("CHECK constraint")) return "short";
  if (message.includes("NOT NULL constraint")) return "gone";
  return null;
}

/**
 * Runs a change whose first statement touches the stock row it's about. "short" when there
 * weren't enough there (nothing changed); "gone" when the row no longer exists.
 */
export async function runStockChange(
  d1: D1Database,
  statements: D1PreparedStatement[],
): Promise<StockOutcome> {
  try {
    const results = await d1.batch(statements);
    return results[0]?.meta.changes === 1 ? "ok" : "gone";
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

export async function loadNames(db: Db): Promise<Names> {
  const [locationRows, robotRows, subsystemRows] = await Promise.all([
    loadLocations(db),
    db.select().from(robots).orderBy(asc(robots.sortOrder), asc(robots.id)).all(),
    db.select().from(subsystems).orderBy(asc(subsystems.sortOrder), asc(subsystems.id)).all(),
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
