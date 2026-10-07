import { requireAuth } from "@g3/auth";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createDb } from "../db";
import { stock } from "../db/schema";
import { parseId, quantityField } from "../lib/input";
import {
  type Place,
  STOCK_ERRORS,
  actorOf,
  addStock,
  describePlace,
  dropIfEmpty,
  loadNames,
  logEvent,
  placeProblem,
  runStockChange,
  takeStock,
  tidyStorage,
  transferNote,
} from "../lib/stock";
import type { AppEnv } from "../types";

// What members do to a row of the main table: count it, move it, put some of it in use on a
// robot (check out), or bring some back to storage (check in). Anyone signed in can, kiosk
// sessions included; every change goes in the entry's history with who made it.

const editValidator = validator("json", (value, c): { quantity?: number; locationId?: number } => {
  const v = (value ?? {}) as Record<string, unknown>;
  const out: { quantity?: number; locationId?: number } = {};
  if (v.quantity !== undefined) {
    const quantity = quantityField(v.quantity);
    if (quantity === null) {
      return c.json({ error: "quantity must be a whole number, 0 or more." }, 400) as never;
    }
    out.quantity = quantity;
  }
  if (v.locationId !== undefined) {
    const locationId = parseId(v.locationId);
    if (locationId === null) return c.json({ error: "Pick a location." }, 400) as never;
    out.locationId = locationId;
  }
  if (out.quantity === undefined && out.locationId === undefined) {
    return c.json({ error: "Nothing to change." }, 400) as never;
  }
  return out;
});

const checkOutValidator = validator(
  "json",
  (value, c): { quantity: number; locationId: number; robotId: number; subsystemId: number } => {
    const v = (value ?? {}) as Record<string, unknown>;
    const fail = (error: string) => c.json({ error }, 400) as never;
    const quantity = quantityField(v.quantity, 1);
    const locationId = parseId(v.locationId);
    const robotId = parseId(v.robotId);
    const subsystemId = parseId(v.subsystemId);
    if (quantity === null) return fail("quantity must be a whole number, 1 or more.");
    if (locationId === null) return fail("Pick a location.");
    if (robotId === null) return fail("Pick a robot.");
    if (subsystemId === null) return fail("Pick a subsystem.");
    return { quantity, locationId, robotId, subsystemId };
  },
);

const checkInValidator = validator("json", (value, c): { quantity: number; locationId: number } => {
  const v = (value ?? {}) as Record<string, unknown>;
  const quantity = quantityField(v.quantity, 1);
  const locationId = parseId(v.locationId);
  if (quantity === null) {
    return c.json({ error: "quantity must be a whole number, 1 or more." }, 400) as never;
  }
  if (locationId === null) return c.json({ error: "Pick a location." }, 400) as never;
  return { quantity, locationId };
});

/** The stock row in the path, as a place. */
async function rowOf(c: Context<AppEnv>) {
  const id = parseId(c.req.param("id"));
  if (id === null) return null;
  const db = createDb(c.env.INVENTORY_DB);
  const row = await db.select().from(stock).where(eq(stock.id, id)).get();
  if (!row) return null;
  const place: Place = {
    locationId: row.locationId,
    status: row.status,
    robotId: row.robotId,
    subsystemId: row.subsystemId,
  };
  return { db, row, place };
}

/**
 * Moves `quantity` from a stock row to another place of the same entry, in one transaction.
 * `evenStorage`: also remove an emptied storage row (a move, where the parts' home moves too).
 */
async function transfer(
  c: Context<AppEnv>,
  from: { id: number; itemId: number },
  to: Place,
  quantity: number,
  event: { action: string; note: string },
  evenStorage: boolean,
) {
  const d1 = c.env.INVENTORY_DB;
  const now = Date.now();
  const outcome = await runStockChange(d1, [
    takeStock(d1, from.id, quantity, now),
    ...addStock(d1, from.itemId, to, quantity, now, from.id),
    logEvent(d1, from.itemId, event.action, event.note, actorOf(c), now, from.id),
    dropIfEmpty(d1, from.id, evenStorage),
    ...(to.status === "storage" ? [tidyStorage(d1, from.itemId, to.locationId)] : []),
  ]);
  if (outcome !== "ok") return c.json({ error: STOCK_ERRORS[outcome] }, 409);
  return c.json({ ok: true });
}

export const stockRouter = new Hono<AppEnv>()
  /**
   * Edits a row from the table: `quantity` records a count (the new number is what's there), and
   * `locationId` moves the whole row somewhere else.
   */
  .patch("/:id", requireAuth, editValidator, async (c) => {
    const found = await rowOf(c);
    if (!found) return c.json({ error: "That row no longer exists. Reload the page." }, 404);
    const { db, row, place } = found;
    const body = c.req.valid("json");
    const names = await loadNames(db);
    const d1 = c.env.INVENTORY_DB;
    let quantity = row.quantity;

    if (body.quantity !== undefined) {
      const now = Date.now();
      const where = describePlace(place, names);
      const note =
        body.quantity === row.quantity
          ? `Confirmed ${row.quantity} in ${where}.`
          : `${row.quantity} → ${body.quantity} in ${where}.`;
      const outcome = await runStockChange(d1, [
        d1
          .prepare(
            "UPDATE stock SET quantity = ?2, counted_at = ?3, counted_by_name = ?4, updated_at = ?3 WHERE id = ?1",
          )
          .bind(row.id, body.quantity, now, actorOf(c).name),
        logEvent(d1, row.itemId, "counted", note, actorOf(c), now, row.id),
        dropIfEmpty(d1, row.id, false),
      ]);
      if (outcome !== "ok") return c.json({ error: STOCK_ERRORS[outcome] }, 409);
      quantity = body.quantity;
      // Parts in use that were counted down to none: the row is gone, so there's nothing to move.
      if (quantity === 0 && row.status === "in_use") return c.json({ ok: true });
    }

    if (body.locationId !== undefined && body.locationId !== row.locationId) {
      const to: Place = { ...place, locationId: body.locationId };
      const problem = placeProblem(to, names);
      if (problem) return c.json({ error: problem }, 400);
      return transfer(
        c,
        row,
        to,
        quantity,
        {
          action: "moved",
          note: transferNote(quantity, place, to, names),
        },
        true,
      );
    }
    return c.json({ ok: true });
  })
  /** Puts some of a storage row in use: on a robot's subsystem, at a location. */
  .post("/:id/check-out", requireAuth, checkOutValidator, async (c) => {
    const found = await rowOf(c);
    if (!found) return c.json({ error: "That row no longer exists. Reload the page." }, 404);
    const { db, row, place } = found;
    if (row.status !== "storage") {
      return c.json({ error: "Those parts are already in use." }, 409);
    }
    const { quantity, ...where } = c.req.valid("json");
    const to: Place = { status: "in_use", ...where };
    const names = await loadNames(db);
    const problem = placeProblem(to, names);
    if (problem) return c.json({ error: problem }, 400);
    return transfer(
      c,
      row,
      to,
      quantity,
      {
        action: "checked_out",
        note: transferNote(quantity, place, to, names),
      },
      false,
    );
  })
  /** Brings some of an in-use row back to storage at a location. */
  .post("/:id/check-in", requireAuth, checkInValidator, async (c) => {
    const found = await rowOf(c);
    if (!found) return c.json({ error: "That row no longer exists. Reload the page." }, 404);
    const { db, row, place } = found;
    if (row.status !== "in_use") {
      return c.json({ error: "Those parts are already in storage." }, 409);
    }
    const { quantity, locationId } = c.req.valid("json");
    const to: Place = { status: "storage", locationId, robotId: null, subsystemId: null };
    const names = await loadNames(db);
    const problem = placeProblem(to, names);
    if (problem) return c.json({ error: problem }, 400);
    return transfer(
      c,
      row,
      to,
      quantity,
      {
        action: "checked_in",
        note: transferNote(quantity, place, to, names),
      },
      false,
    );
  });
