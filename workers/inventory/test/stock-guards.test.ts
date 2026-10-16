import { env } from "cloudflare:test";
import { inTeam, withTeam } from "@g3/auth";
import { newTeamId } from "@g3/testing/users";
import { eq, exists, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { itemEvents, items, locations, stock } from "../src/db/schema";
import {
  addStock,
  batch,
  dropIfEmpty,
  logEvent,
  mustExist,
  refusal,
  runStockChange,
  takeStock,
} from "../src/lib/stock";

// The guards a stock change relies on when someone else changes the same rows at the same time,
// which the routes' tests can't reach: a row that's gone by the time the batch runs, and a batch
// that must fail outright unless something still exists. Nothing may change either way.

const db = createDb((env as unknown as { INVENTORY_DB: D1Database }).INVENTORY_DB);
const by = { id: "u", name: "Tester" };

async function setup() {
  const team = newTeamId();
  const now = Date.now();
  const location = await db
    .insert(locations)
    .values(withTeam(team, { name: "Shelf", createdAt: now }))
    .returning({ id: locations.id })
    .get();
  const item = await db
    .insert(items)
    .values(
      withTeam(team, {
        name: "Bolt",
        createdById: "u",
        createdByName: "Tester",
        createdAt: now,
        updatedAt: now,
      }),
    )
    .returning({ id: items.id })
    .get();
  const place = {
    locationId: location.id,
    status: "storage" as const,
    robotId: null,
    subsystemId: null,
  };
  await batch(db, addStock(db, team, item.id, place, 5, now));
  const row = await db.select().from(stock).where(inTeam(stock, team)).get();
  return { team, item: item.id, place, row: row?.id as number };
}

const stockOf = (team: string) =>
  db.select({ quantity: stock.quantity }).from(stock).where(inTeam(stock, team)).all();
const eventsOf = (team: string) =>
  db.select().from(itemEvents).where(inTeam(itemEvents, team)).all();

describe("stock guards", () => {
  it("adds to a place's row, or makes one", async () => {
    const { team, item, place } = await setup();
    await batch(db, addStock(db, team, item, place, 3, Date.now()));
    expect(await stockOf(team)).toEqual([{ quantity: 8 }]);
  });

  it("refuses to take more than a row holds, changing nothing", async () => {
    const { team, row } = await setup();
    const outcome = await runStockChange(db, [takeStock(db, team, row, 6, Date.now())]);
    expect(outcome).toBe("short");
    expect(await stockOf(team)).toEqual([{ quantity: 5 }]);
  });

  it("does nothing with a row that's gone: no parts appear elsewhere, no history", async () => {
    const { team, item, place, row } = await setup();
    await db.delete(stock).where(inTeam(stock, team, eq(stock.id, row)));
    const elsewhere = { ...place, status: "in_use" as const, robotId: 1, subsystemId: 1 };
    const now = Date.now();
    const outcome = await runStockChange(db, [
      takeStock(db, team, row, 2, now),
      ...addStock(db, team, item, elsewhere, 2, now, row),
      logEvent(db, team, item, "checked_out", "2 out.", by, now, row),
      dropIfEmpty(db, team, row, false),
    ]);
    expect(outcome).toBe("gone");
    expect(await stockOf(team)).toEqual([]);
    expect(await eventsOf(team)).toEqual([]);
  });

  it("fails a whole batch when what it needs is gone", async () => {
    const { team, item, row } = await setup();
    const missing = exists(
      db
        .select({ one: sql`1` })
        .from(stock)
        .where(inTeam(stock, team, eq(stock.id, row + 1000))),
    );
    let error: unknown;
    try {
      await batch(db, [
        takeStock(db, team, row, 1, Date.now()),
        mustExist(db, team, item, missing),
      ]);
    } catch (err) {
      error = err;
    }
    expect(refusal(error)).toBe("gone");
    // The first statement was undone with the rest.
    expect(await stockOf(team)).toEqual([{ quantity: 5 }]);
  });

  it("never touches another team's rows, even by id", async () => {
    const mine = await setup();
    const theirs = await setup();
    const outcome = await runStockChange(db, [takeStock(db, mine.team, theirs.row, 1, Date.now())]);
    expect(outcome).toBe("gone");
    expect(await stockOf(theirs.team)).toEqual([{ quantity: 5 }]);
  });
});
