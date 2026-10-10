import { inTeam, requireAuth, requireMentor, withTeam } from "@g3/auth";
import { type SQL, desc, eq, exists, gt, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type Db, createDb } from "../db";
import {
  STOCK_STATUSES,
  intakeReceipts,
  itemEvents,
  itemListings,
  items,
  stock,
} from "../db/schema";
import { applyValues, loadFields, parseValues } from "../lib/fields";
import { parseId, quantityField, textField } from "../lib/input";
import { type ListingInput, listingLabel, loadItems, parseListing } from "../lib/items";
import {
  type Place,
  STOCK_ERRORS,
  type StockTable,
  actorOf,
  addStock,
  batch,
  describePlace,
  dropIfEmpty,
  loadNames,
  logEvent,
  mustExist,
  placeProblem,
  refusal,
  takeStock,
  tidyStorage,
} from "../lib/stock";
import type { AppEnv } from "../types";

// Entries: one kind of part each, with the team's fields, the vendors' listings it can be bought
// as, and its history. Anyone signed in adds and edits them (kiosk sessions too); mentors and
// admins delete, merge and split.

/** An entry's history, newest first. This many lines at most are sent. */
const HISTORY_LIMIT = 500;

const GONE = "That entry no longer exists.";

/** Other names for the stock table, for subqueries about other rows of it. */
const s = alias(stock, "s");
const t = alias(stock, "t");

/** The team's entry a catalog part is already listed on, if any (other than `exceptItemId`). */
async function catalogOwner(db: Db, team: string, catalogItemId: number, exceptItemId?: number) {
  return db
    .select({ id: items.id, name: items.name })
    .from(itemListings)
    .innerJoin(items, inTeam(items, team, eq(items.id, itemListings.itemId)))
    .where(
      inTeam(
        itemListings,
        team,
        eq(itemListings.catalogItemId, catalogItemId),
        exceptItemId === undefined ? undefined : ne(itemListings.itemId, exceptItemId),
      ),
    )
    .get();
}

function insertListing(db: Db, team: string, itemId: number, listing: ListingInput, now: number) {
  return db.insert(itemListings).values(withTeam(team, { ...listing, itemId, createdAt: now }));
}

/** The team's entry `id`, as stored. */
const itemRow = (db: Db, team: string, id: number | null) =>
  id === null
    ? null
    : db
        .select()
        .from(items)
        .where(inTeam(items, team, eq(items.id, id)))
        .get();

type NewItem = {
  name: string;
  values: unknown;
  /** Where the parts are kept and how many there are, if that's known yet. */
  stock: { quantity: number; locationId: number } | null;
  listing: ListingInput | null;
};

const newItemValidator = validator("json", (value, c): NewItem => {
  const v = (value ?? {}) as Record<string, unknown>;
  const fail = (error: string) => c.json({ error }, 400) as never;
  const name = textField(v.name, 200, true);
  if (name === null) return fail("name must be 1–200 characters.");
  let stock: NewItem["stock"] = null;
  if (v.stock !== undefined && v.stock !== null) {
    const s = v.stock as Record<string, unknown>;
    const quantity = quantityField(s.quantity);
    const locationId = parseId(s.locationId);
    if (quantity === null) return fail("quantity must be a whole number, 0 or more.");
    if (locationId === null) return fail("Pick a location.");
    stock = { quantity, locationId };
  }
  let listing: ListingInput | null = null;
  if (v.listing !== undefined && v.listing !== null) {
    const parsed = parseListing(v.listing);
    if ("error" in parsed) return fail(parsed.error);
    listing = parsed;
  }
  return { name, values: v.values ?? {}, stock, listing };
});

const editValidator = validator("json", (value, c): { name?: string; values?: unknown } => {
  const v = (value ?? {}) as Record<string, unknown>;
  const out: { name?: string; values?: unknown } = {};
  if (v.name !== undefined) {
    const name = textField(v.name, 200, true);
    if (name === null) return c.json({ error: "name must be 1–200 characters." }, 400) as never;
    out.name = name;
  }
  if (v.values !== undefined) out.values = v.values;
  return out;
});

const stockValidator = validator("json", (value, c): Place & { quantity: number } => {
  const v = (value ?? {}) as Record<string, unknown>;
  const fail = (error: string) => c.json({ error }, 400) as never;
  const status = STOCK_STATUSES.find((s) => s === (v.status ?? "storage"));
  if (!status) return fail("status must be storage or in_use.");
  const quantity = quantityField(v.quantity, status === "in_use" ? 1 : 0);
  if (quantity === null) return fail("quantity must be a whole number.");
  const locationId = parseId(v.locationId);
  if (locationId === null) return fail("Pick a location.");
  const inUse = status === "in_use";
  return {
    status,
    quantity,
    locationId,
    robotId: inUse ? parseId(v.robotId) : null,
    subsystemId: inUse ? parseId(v.subsystemId) : null,
  };
});

const listingValidator = validator("json", (value, c): ListingInput => {
  const parsed = parseListing(value);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400) as never;
  return parsed;
});

const mergeValidator = validator("json", (value, c): { fromId: number } => {
  const fromId = parseId((value as Record<string, unknown> | null)?.fromId);
  if (fromId === null) return c.json({ error: "Pick the entry to merge in." }, 400) as never;
  return { fromId };
});

type Split = {
  listingId: number;
  name: string;
  /** How many of each stock row go with the listing. */
  stock: { stockId: number; quantity: number }[];
};

const splitValidator = validator("json", (value, c): Split => {
  const v = (value ?? {}) as Record<string, unknown>;
  const fail = (error: string) => c.json({ error }, 400) as never;
  const listingId = parseId(v.listingId);
  if (listingId === null) return fail("Pick the listing to split off.");
  const name = textField(v.name ?? "", 200);
  if (name === null) return fail("name must be up to 200 characters.");
  const rows = v.stock ?? [];
  if (!Array.isArray(rows) || rows.length > 50) return fail("stock must be a list.");
  const stock: Split["stock"] = [];
  for (const raw of rows as Record<string, unknown>[]) {
    const stockId = parseId(raw?.stockId);
    const quantity = quantityField(raw?.quantity, 1);
    if (stockId === null || quantity === null || stock.some((s) => s.stockId === stockId)) {
      return fail("stock must list each row once, with a quantity of 1 or more.");
    }
    stock.push({ stockId, quantity });
  }
  return { listingId, name, stock };
});

export const itemsRouter = new Hono<AppEnv>()
  .post("/", requireAuth, newItemValidator, async (c) => {
    const body = c.req.valid("json");
    const db = createDb(c.env.INVENTORY_DB);
    const team = c.get("teamId");

    const applied = applyValues(body.values, {}, await loadFields(db, team));
    if ("error" in applied) return c.json({ error: applied.error }, 400);
    const names = await loadNames(db, team);
    const place: Place | null = body.stock
      ? { locationId: body.stock.locationId, status: "storage", robotId: null, subsystemId: null }
      : null;
    const problem = place && placeProblem(place, names);
    if (problem) return c.json({ error: problem }, 400);
    if (body.listing?.catalogItemId) {
      const owner = await catalogOwner(db, team, body.listing.catalogItemId);
      if (owner) {
        return c.json(
          { error: `That catalog part is already on "${owner.name}".`, itemId: owner.id },
          409,
        );
      }
    }

    const now = Date.now();
    const by = actorOf(c);
    const made = await db
      .insert(items)
      .values(
        withTeam(team, {
          name: body.name,
          fieldValues: JSON.stringify(applied.values),
          createdById: by.id,
          createdByName: by.name,
          createdAt: now,
          updatedAt: now,
        }),
      )
      .returning({ id: items.id })
      .get();
    const note =
      place && body.stock ? `${body.stock.quantity} in ${describePlace(place, names)}.` : null;
    try {
      await db.batch([
        logEvent(db, team, made.id, "created", note, by, now),
        ...(body.listing ? [insertListing(db, team, made.id, body.listing, now)] : []),
        ...(place && body.stock
          ? addStock(db, team, made.id, place, body.stock.quantity, now)
          : []),
      ]);
    } catch (err) {
      await db.delete(items).where(inTeam(items, team, eq(items.id, made.id)));
      throw err;
    }
    return c.json({ id: made.id }, 201);
  })
  /** One entry with its stock, listings and history (newest first). */
  .get("/:id", requireAuth, async (c) => {
    const id = parseId(c.req.param("id"));
    const db = createDb(c.env.INVENTORY_DB);
    const team = c.get("teamId");
    const [item] = id === null ? [] : await loadItems(db, team, id);
    if (!item) return c.json({ error: GONE }, 404);
    const events = await db
      .select({
        id: itemEvents.id,
        action: itemEvents.action,
        note: itemEvents.note,
        ref: itemEvents.ref,
        userName: itemEvents.userName,
        createdAt: itemEvents.createdAt,
      })
      .from(itemEvents)
      .where(inTeam(itemEvents, team, eq(itemEvents.itemId, item.id)))
      .orderBy(desc(itemEvents.createdAt), desc(itemEvents.id))
      .limit(HISTORY_LIMIT)
      .all();
    return c.json({ item, events });
  })
  .patch("/:id", requireAuth, editValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    const db = createDb(c.env.INVENTORY_DB);
    const team = c.get("teamId");
    const row = await itemRow(db, team, id);
    if (!row) return c.json({ error: GONE }, 404);
    const body = c.req.valid("json");

    const changed: string[] = [];
    const name = body.name ?? row.name;
    if (name !== row.name) changed.push("Name");
    let fieldValues = row.fieldValues;
    if (body.values !== undefined) {
      const applied = applyValues(
        body.values,
        parseValues(row.fieldValues),
        await loadFields(db, team),
      );
      if ("error" in applied) return c.json({ error: applied.error }, 400);
      changed.push(...applied.changed);
      fieldValues = JSON.stringify(applied.values);
    }
    if (changed.length === 0) return c.json({ ok: true });

    const now = Date.now();
    const note =
      name !== row.name && changed.length === 1
        ? `Renamed from "${row.name}".`
        : `Changed ${changed.join(", ")}.`;
    await db.batch([
      db
        .update(items)
        .set({ name, fieldValues, updatedAt: now })
        .where(inTeam(items, team, eq(items.id, row.id))),
      logEvent(db, team, row.id, "edited", note, actorOf(c), now),
    ]);
    return c.json({ ok: true });
  })
  /** Removes an entry with its stock, listings and history. */
  .delete("/:id", requireMentor, async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ error: GONE }, 404);
    await createDb(c.env.INVENTORY_DB)
      .delete(items)
      .where(inTeam(items, c.get("teamId"), eq(items.id, id)));
    return c.json({ ok: true });
  })
  /** Adds parts that weren't counted before (found, donated, made), or gives an entry a home. */
  .post("/:id/stock", requireAuth, stockValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    const db = createDb(c.env.INVENTORY_DB);
    const team = c.get("teamId");
    const row = await itemRow(db, team, id);
    if (!row) return c.json({ error: GONE }, 404);
    const { quantity, ...place } = c.req.valid("json");
    const names = await loadNames(db, team);
    const problem = placeProblem(place, names);
    if (problem) return c.json({ error: problem }, 400);

    const now = Date.now();
    const where = describePlace(place, names);
    await batch(db, [
      ...addStock(db, team, row.id, place, quantity, now),
      logEvent(
        db,
        team,
        row.id,
        "added",
        quantity > 0 ? `${quantity} in ${where}.` : `Kept in ${where}.`,
        actorOf(c),
        now,
      ),
      ...(place.status === "storage" ? [tidyStorage(db, team, row.id, place.locationId)] : []),
    ]);
    return c.json({ ok: true });
  })
  /** Adds a way to buy the entry: a part from Orders' catalog, or a vendor's page typed in. */
  .post("/:id/listings", requireAuth, listingValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    const db = createDb(c.env.INVENTORY_DB);
    const team = c.get("teamId");
    const row = await itemRow(db, team, id);
    if (!row) return c.json({ error: GONE }, 404);
    const listing = c.req.valid("json");
    if (listing.catalogItemId) {
      const mine = await db
        .select({ id: itemListings.id })
        .from(itemListings)
        .where(
          inTeam(
            itemListings,
            team,
            eq(itemListings.itemId, row.id),
            eq(itemListings.catalogItemId, listing.catalogItemId),
          ),
        )
        .get();
      if (mine) return c.json({ error: "That catalog part is already on this entry." }, 409);
      const owner = await catalogOwner(db, team, listing.catalogItemId, row.id);
      if (owner) {
        return c.json(
          {
            error: `That catalog part is already on "${owner.name}". Merge the two entries to combine them.`,
            itemId: owner.id,
          },
          409,
        );
      }
    }
    const now = Date.now();
    const what = listing.catalogItemId ? " from the Orders catalog" : "";
    await db.batch([
      insertListing(db, team, row.id, listing, now),
      logEvent(db, team, row.id, "linked", `${listingLabel(listing)}${what}.`, actorOf(c), now),
    ]);
    return c.json({ ok: true }, 201);
  })
  .delete("/:id/listings/:listingId", requireAuth, async (c) => {
    const id = parseId(c.req.param("id"));
    const listingId = parseId(c.req.param("listingId"));
    const db = createDb(c.env.INVENTORY_DB);
    const team = c.get("teamId");
    const listing =
      id === null || listingId === null
        ? null
        : await db
            .select()
            .from(itemListings)
            .where(
              inTeam(
                itemListings,
                team,
                eq(itemListings.id, listingId),
                eq(itemListings.itemId, id),
              ),
            )
            .get();
    if (!listing) return c.json({ error: "That listing is no longer on this entry." }, 404);
    const now = Date.now();
    await db.batch([
      db.delete(itemListings).where(inTeam(itemListings, team, eq(itemListings.id, listing.id))),
      logEvent(db, team, listing.itemId, "unlinked", `${listingLabel(listing)}.`, actorOf(c), now),
    ]);
    return c.json({ ok: true });
  })
  /**
   * Combines another entry into this one: equivalent parts (the same bolt from two vendors) as one
   * entry. Its stock, listings and history move here, its values fill this entry's blanks, and it
   * is gone.
   */
  .post("/:id/merge", requireMentor, mergeValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    const { fromId } = c.req.valid("json");
    const db = createDb(c.env.INVENTORY_DB);
    const team = c.get("teamId");
    if (id === fromId) return c.json({ error: "Pick a different entry to merge in." }, 400);
    const [[into], [from]] =
      id === null
        ? [[], []]
        : await Promise.all([loadItems(db, team, id), loadItems(db, team, fromId)]);
    if (!into) return c.json({ error: GONE }, 404);
    if (!from) return c.json({ error: "The entry to merge in no longer exists." }, 404);

    const now = Date.now();
    const defs = await loadFields(db, team);
    const values = Object.fromEntries(
      Object.entries({ ...from.values, ...into.values }).filter(([key]) =>
        defs.some((def) => String(def.id) === key),
      ),
    );
    const parts = from.stock.reduce((sum, row) => sum + row.quantity, 0);
    const listings = from.listings.length;
    const note = `"${from.name}" merged in: ${parts} ${parts === 1 ? "part" : "parts"}, ${listings} ${
      listings === 1 ? "listing" : "listings"
    }.`;
    // `same` matches another row with the stock row in the same place.
    const same = (other: StockTable): SQL[] => [
      eq(other.locationId, stock.locationId),
      eq(other.status, stock.status),
      sql`${other.robotId} IS ${stock.robotId}`,
      sql`${other.subsystemId} IS ${stock.subsystemId}`,
    ];
    const statements: BatchItem<"sqlite">[] = [
      db
        .update(items)
        .set({ fieldValues: JSON.stringify(values), updatedAt: now })
        .where(inTeam(items, team, eq(items.id, into.id))),
      // Where both have parts in the same place, the quantities add up...
      db
        .update(stock)
        .set({
          updatedAt: now,
          quantity: sql`${stock.quantity} + (${db
            .select({ quantity: s.quantity })
            .from(s)
            .where(inTeam(s, team, eq(s.itemId, from.id), ...same(s)))})`,
        })
        .where(
          inTeam(
            stock,
            team,
            eq(stock.itemId, into.id),
            exists(
              db
                .select({ one: sql`1` })
                .from(s)
                .where(inTeam(s, team, eq(s.itemId, from.id), ...same(s))),
            ),
          ),
        ),
      db.delete(stock).where(
        inTeam(
          stock,
          team,
          eq(stock.itemId, from.id),
          exists(
            db
              .select({ one: sql`1` })
              .from(t)
              .where(inTeam(t, team, eq(t.itemId, into.id), ...same(t))),
          ),
        ),
      ),
      // ...and everything else just changes entry.
      db
        .update(stock)
        .set({ itemId: into.id, updatedAt: now })
        .where(inTeam(stock, team, eq(stock.itemId, from.id))),
      db.delete(stock).where(
        inTeam(
          stock,
          team,
          eq(stock.itemId, into.id),
          eq(stock.status, "storage"),
          eq(stock.quantity, 0),
          exists(
            db
              .select({ one: sql`1` })
              .from(s)
              .where(
                inTeam(s, team, eq(s.itemId, into.id), eq(s.status, "storage"), gt(s.quantity, 0)),
              ),
          ),
        ),
      ),
      db
        .update(itemListings)
        .set({ itemId: into.id })
        .where(inTeam(itemListings, team, eq(itemListings.itemId, from.id))),
      db
        .update(itemEvents)
        .set({ itemId: into.id })
        .where(inTeam(itemEvents, team, eq(itemEvents.itemId, from.id))),
      db
        .update(intakeReceipts)
        .set({ itemId: into.id })
        .where(inTeam(intakeReceipts, team, eq(intakeReceipts.itemId, from.id))),
      db.delete(items).where(inTeam(items, team, eq(items.id, from.id))),
      logEvent(db, team, into.id, "merged", note, actorOf(c), now),
    ];
    try {
      await batch(db, statements);
    } catch (err) {
      console.error("[inventory] merge", err);
      return c.json({ error: "Those entries changed while merging. Reload and try again." }, 409);
    }
    return c.json({ ok: true });
  })
  /**
   * Undoes a merge for one listing: it becomes its own entry, with the same values, and with as
   * many of the parts as the mentor says are that vendor's.
   */
  .post("/:id/split", requireMentor, splitValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    const body = c.req.valid("json");
    const db = createDb(c.env.INVENTORY_DB);
    const team = c.get("teamId");
    const [item] = id === null ? [] : await loadItems(db, team, id);
    if (!item) return c.json({ error: GONE }, 404);
    const listing = item.listings.find((l) => l.id === body.listingId);
    if (!listing) return c.json({ error: "That listing is no longer on this entry." }, 404);
    if (item.listings.length < 2) {
      return c.json({ error: "An entry with one listing has nothing to split off." }, 400);
    }
    const moves = [];
    for (const move of body.stock) {
      const row = item.stock.find((s) => s.id === move.stockId);
      if (!row || row.quantity < move.quantity) {
        return c.json({ error: STOCK_ERRORS.short }, 409);
      }
      moves.push({ ...move, place: row satisfies Place as Place });
    }

    const now = Date.now();
    const by = actorOf(c);
    const row = await itemRow(db, team, item.id);
    const name = body.name || listing.name || listingLabel(listing);
    const made = await db
      .insert(items)
      .values(
        withTeam(team, {
          name,
          fieldValues: row?.fieldValues ?? "{}",
          createdById: by.id,
          createdByName: by.name,
          createdAt: now,
          updatedAt: now,
        }),
      )
      .returning({ id: items.id })
      .get();
    const moved = moves.reduce((sum, move) => sum + move.quantity, 0);
    try {
      await db.batch([
        // Nothing moves unless the listing is still this entry's (against the new entry, which
        // certainly exists).
        mustExist(
          db,
          team,
          made.id,
          exists(
            db
              .select({ one: sql`1` })
              .from(itemListings)
              .where(
                inTeam(
                  itemListings,
                  team,
                  eq(itemListings.id, listing.id),
                  eq(itemListings.itemId, item.id),
                ),
              ),
          ),
        ),
        db
          .update(itemListings)
          .set({ itemId: made.id })
          .where(inTeam(itemListings, team, eq(itemListings.id, listing.id))),
        ...moves.flatMap((move) => [
          mustExist(
            db,
            team,
            made.id,
            exists(
              db
                .select({ one: sql`1` })
                .from(s)
                .where(inTeam(s, team, eq(s.id, move.stockId), eq(s.itemId, item.id))),
            ),
          ),
          takeStock(db, team, move.stockId, move.quantity, now),
          ...addStock(db, team, made.id, move.place, move.quantity, now),
          dropIfEmpty(db, team, move.stockId, false),
        ]),
        logEvent(
          db,
          team,
          item.id,
          "split",
          `"${name}" split off as its own entry${moved > 0 ? `, with ${moved}` : ""}.`,
          by,
          now,
          null,
          `item:${made.id}`,
        ),
        logEvent(
          db,
          team,
          made.id,
          "split",
          `Split from "${item.name}".`,
          by,
          now,
          null,
          `item:${item.id}`,
        ),
      ]);
    } catch (err) {
      await db.delete(items).where(inTeam(items, team, eq(items.id, made.id)));
      const why = refusal(err);
      if (why) return c.json({ error: STOCK_ERRORS[why] }, 409);
      throw err;
    }
    return c.json({ id: made.id }, 201);
  });
