import { requireAuth } from "@g3/auth";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type Db, createDb } from "../db";
import { type StockStatus, intakeReceipts, itemListings, items } from "../db/schema";
import { parseId, quantityField, textField } from "../lib/input";
import type { IntakeRequest, IntakeResult, PlacesResult } from "../lib/intake-types";
import { type ListingInput, listingLabel, parseListing } from "../lib/items";
import {
  type Place,
  actorOf,
  addStock,
  describePlace,
  loadNames,
  logEvent,
  placeProblem,
  tidyStorage,
} from "../lib/stock";
import type { AppEnv } from "../types";

// Parts arriving from another app: Orders sends what was just received, with where the person
// receiving it says it's going. It comes with that person's session, so it's allowed to do what
// they could do in Inventory by hand (anyone signed in can add parts), and no more.
//
// A delivery finds its entry by the vendor's listing: the same part in Orders' catalog, else the
// same vendor and part number, else the same link. A part Inventory hasn't seen becomes a new
// entry. Each delivery is named by a `sourceKey` and added once, however often it's sent.

const MAX_LINES = 50;

type Line = {
  sourceKey: string;
  quantity: number;
  name: string;
  listing: ListingInput;
  note: string | null;
  /** Where this delivery goes: its own location, or the one given for them all. */
  locationId: number;
};

/** What every delivery in a request shares: storage, or in use on a robot's subsystem. */
type Use = { status: StockStatus; robotId: number | null; subsystemId: number | null };

const intakeValidator = validator("json", (value, c): { use: Use; lines: Line[] } => {
  const v = (value ?? {}) as Partial<Record<keyof IntakeRequest, unknown>>;
  const fail = (error: string) => c.json({ error }, 400) as never;

  const d = (v.destination ?? {}) as Record<string, unknown>;
  if (d.status !== "storage" && d.status !== "in_use") {
    return fail("status must be storage or in_use.");
  }
  const inUse = d.status === "in_use";
  const use: Use = {
    status: d.status,
    robotId: inUse ? parseId(d.robotId) : null,
    subsystemId: inUse ? parseId(d.subsystemId) : null,
  };
  // The location for deliveries that don't name their own.
  const shared = parseId(d.locationId);

  if (!Array.isArray(v.lines) || v.lines.length === 0 || v.lines.length > MAX_LINES) {
    return fail(`lines must be a list of 1–${MAX_LINES} deliveries.`);
  }
  const lines: Line[] = [];
  for (const raw of v.lines as Record<string, unknown>[]) {
    const sourceKey = textField(raw?.sourceKey, 100, true);
    const quantity = quantityField(raw?.quantity, 1);
    const name = textField(raw?.name ?? "", 300);
    const note = textField(raw?.note ?? "", 200);
    if (sourceKey === null || lines.some((line) => line.sourceKey === sourceKey)) {
      return fail("Each delivery needs its own sourceKey.");
    }
    if (quantity === null) return fail("quantity must be a whole number, 1 or more.");
    if (name === null || note === null) return fail("A delivery's name or note is too long.");
    const own = raw.locationId === undefined || raw.locationId === null ? null : raw.locationId;
    const locationId = own === null ? shared : parseId(own);
    if (locationId === null) return fail("Pick a location.");
    const listing = parseListing(raw.listing);
    if ("error" in listing) return fail(listing.error);
    lines.push({ sourceKey, quantity, name, listing, note: note || null, locationId });
  }
  return { use, lines };
});

const placesValidator = validator(
  "json",
  (value, c): { lines: { sourceKey: string; listing: ListingInput }[] } => {
    const raw = (value as { lines?: unknown } | null)?.lines;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) {
      return c.json({ error: `lines must be a list of 1–${MAX_LINES} parts.` }, 400) as never;
    }
    const lines = [];
    for (const line of raw as Record<string, unknown>[]) {
      const sourceKey = textField(line?.sourceKey, 100, true);
      const listing = parseListing(line?.listing);
      if (sourceKey === null || "error" in listing) {
        return c.json({ error: "Each part needs a sourceKey and a listing." }, 400) as never;
      }
      lines.push({ sourceKey, listing });
    }
    return { lines };
  },
);

/** The entry's listing a delivery belongs to, if Inventory has the part. */
async function findListing(db: Db, listing: ListingInput) {
  const pick = { id: itemListings.id, itemId: itemListings.itemId };
  if (listing.catalogItemId) {
    const byCatalog = await db
      .select(pick)
      .from(itemListings)
      .where(eq(itemListings.catalogItemId, listing.catalogItemId))
      .get();
    if (byCatalog) return byCatalog;
  }
  if (listing.vendor && listing.sku) {
    const bySku = await db
      .select(pick)
      .from(itemListings)
      .where(
        sql`lower(${itemListings.vendor}) = ${listing.vendor.toLowerCase()}
            AND lower(${itemListings.sku}) = ${listing.sku.toLowerCase()}`,
      )
      .get();
    if (bySku) return bySku;
  }
  if (listing.url) {
    const byUrl = await db
      .select(pick)
      .from(itemListings)
      .where(eq(itemListings.url, listing.url))
      .get();
    if (byUrl) return byUrl;
  }
  return null;
}

export const intakeRouter = new Hono<AppEnv>()
  .post("/", requireAuth, intakeValidator, async (c) => {
    const { use, lines } = c.req.valid("json");
    const d1 = c.env.INVENTORY_DB;
    const db = createDb(d1);
    const names = await loadNames(db);

    // Every place is checked before anything is added, so a bad one adds nothing.
    const places = new Map<number, Place>();
    for (const { locationId } of lines) {
      if (places.has(locationId)) continue;
      const place: Place = { ...use, locationId };
      const problem = placeProblem(place, names);
      if (problem) return c.json({ error: problem }, 400);
      places.set(locationId, place);
    }

    const by = actorOf(c);
    const added: IntakeResult["added"] = [];

    // One delivery at a time, so two of the same new part in one order land on one entry.
    for (const line of lines) {
      const place = places.get(line.locationId) as Place;
      const where = describePlace(place, names);
      const receipt = () =>
        db
          .select({ itemId: intakeReceipts.itemId })
          .from(intakeReceipts)
          .where(eq(intakeReceipts.sourceKey, line.sourceKey))
          .get();
      const before = await receipt();
      if (before) {
        added.push({ sourceKey: line.sourceKey, ...before, created: false, duplicate: true });
        continue;
      }

      const now = Date.now();
      const found = await findListing(db, line.listing);
      let itemId = found?.itemId;
      if (itemId === undefined) {
        const made = await db
          .insert(items)
          .values({
            name: (line.name || line.listing.name || listingLabel(line.listing)).slice(0, 200),
            createdById: by.id,
            createdByName: by.name,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: items.id })
          .get();
        itemId = made.id;
      }

      const listing = line.listing;
      const statements = [
        // First, and unique: a delivery that's already been added stops here.
        d1
          .prepare(
            "INSERT INTO intake_receipts (source_key, item_id, created_at) VALUES (?1, ?2, ?3)",
          )
          .bind(line.sourceKey, itemId, now),
        found
          ? // The listing learns what Orders knows now: the catalog part, and the latest price.
            d1
              .prepare(
                `UPDATE item_listings SET
                   catalog_item_id = COALESCE(catalog_item_id, ?2),
                   price_cents = COALESCE(?3, price_cents),
                   price_at = CASE WHEN ?3 IS NULL THEN price_at ELSE ?4 END
                 WHERE id = ?1`,
              )
              .bind(found.id, listing.catalogItemId, listing.priceCents, listing.priceAt ?? now)
          : d1
              .prepare(
                `INSERT INTO item_listings
                   (item_id, catalog_item_id, vendor, sku, name, url, price_cents, price_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
              )
              .bind(
                itemId,
                listing.catalogItemId,
                listing.vendor,
                listing.sku,
                listing.name || line.name,
                listing.url,
                listing.priceCents,
                listing.priceCents === null ? null : (listing.priceAt ?? now),
                now,
              ),
        ...(found ? [] : [logEvent(d1, itemId, "created", "From a received order.", by, now)]),
        ...addStock(d1, itemId, place, line.quantity, now),
        logEvent(
          d1,
          itemId,
          "received",
          `${line.quantity} into ${where}${line.note ? ` (${line.note})` : ""}.`,
          by,
          now,
          null,
          line.sourceKey,
        ),
        ...(place.status === "storage" ? [tidyStorage(d1, itemId, place.locationId)] : []),
      ];
      try {
        await d1.batch(statements);
        added.push({ sourceKey: line.sourceKey, itemId, created: !found, duplicate: false });
      } catch (err) {
        if (!found) await db.delete(items).where(eq(items.id, itemId));
        // Sent twice at the same moment: the other one added it.
        const after = await receipt();
        if (!after) throw err;
        added.push({ sourceKey: line.sourceKey, ...after, created: false, duplicate: true });
      }
    }
    return c.json({ added } satisfies IntakeResult);
  })
  /**
   * Where parts that are about to arrive are already kept: for each, the entry Inventory would
   * add it to (found the same way as a delivery) and the location of that entry's parts in
   * storage. For suggesting where a delivery goes; nothing is changed.
   */
  .post("/places", requireAuth, placesValidator, async (c) => {
    const { lines } = c.req.valid("json");
    const d1 = c.env.INVENTORY_DB;
    const db = createDb(d1);
    const places: PlacesResult["places"] = [];
    for (const line of lines) {
      const found = await findListing(db, line.listing);
      if (!found) {
        places.push({ sourceKey: line.sourceKey, itemId: null, itemName: null, locationId: null });
        continue;
      }
      // Where it's kept: storage before in use, a row with parts before an empty one.
      const home = await d1
        .prepare(
          `SELECT i.name AS itemName,
                  (SELECT s.location_id FROM stock s WHERE s.item_id = i.id
                   ORDER BY s.status = 'in_use', s.quantity = 0, s.id LIMIT 1) AS locationId
           FROM items i WHERE i.id = ?1`,
        )
        .bind(found.itemId)
        .first<{ itemName: string; locationId: number | null }>();
      places.push({
        sourceKey: line.sourceKey,
        itemId: found.itemId,
        itemName: home?.itemName ?? null,
        locationId: home?.locationId ?? null,
      });
    }
    return c.json({ places } satisfies PlacesResult);
  });
