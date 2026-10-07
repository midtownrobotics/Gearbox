import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// All of this is one team's data. Ids are row numbers and nothing is unique by name across a
// table (names are checked among siblings in code), so a team column can be added later without
// rebuilding tables (roadmap Phase 3).

export const FIELD_TYPES = [
  "text",
  "paragraph",
  "number",
  "choice",
  "checkbox",
  "link",
  "date",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** What a team records about a part, beyond its name. Admins define these. */
export const fields = sqliteTable("fields", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", { enum: FIELD_TYPES }).notNull(),
  /** For a choice field: the JSON list of choices. */
  options: text("options").notNull().default("[]"),
  /** Whether the main table has a column for it. */
  showInTable: integer("show_in_table").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

/** Where things are kept: a tree, at most four levels deep (lib/locations.ts). */
export const locations = sqliteTable(
  "locations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    parentId: integer("parent_id"),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("locations_parent_idx").on(t.parentId)],
);

/** What a part in use is in use on. */
export const robots = sqliteTable("robots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const subsystems = sqliteTable("subsystems", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

/** An inventory entry: one kind of part, whichever vendors it comes from. */
export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** JSON object of the team's fields: field id -> value. */
  fieldValues: text("field_values").notNull().default("{}"),
  createdById: text("created_by_id").notNull(),
  createdByName: text("created_by_name").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * A way to buy an entry: one vendor's SKU. Equivalent parts from several vendors are several
 * listings on one entry. `catalogItemId` is the part's id in Orders' catalog when it's linked to
 * one; the rest is copied from there (or typed in) so it shows without Orders.
 */
export const itemListings = sqliteTable(
  "item_listings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    catalogItemId: integer("catalog_item_id"),
    vendor: text("vendor").notNull().default(""),
    sku: text("sku"),
    name: text("name").notNull().default(""),
    url: text("url"),
    priceCents: integer("price_cents"),
    priceAt: integer("price_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("item_listings_item_idx").on(t.itemId),
    index("item_listings_catalog_idx").on(t.catalogItemId),
  ],
);

export const STOCK_STATUSES = ["storage", "in_use"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

/**
 * How many of an entry are in one place. In storage, that's a location. In use, it's a location
 * and the robot and subsystem it's in use on. A row is kept at zero when everything moves out of
 * it, so the entry remembers where it lives (lib/stock.ts).
 */
export const stock = sqliteTable(
  "stock",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id),
    status: text("status", { enum: STOCK_STATUSES }).notNull(),
    robotId: integer("robot_id").references(() => robots.id),
    subsystemId: integer("subsystem_id").references(() => subsystems.id),
    /** Never below zero: the table's CHECK fails a change that would take out more than is there. */
    quantity: integer("quantity").notNull(),
    /** When someone last counted this row, and who. */
    countedAt: integer("counted_at"),
    countedByName: text("counted_by_name"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("stock_item_idx").on(t.itemId),
    index("stock_location_idx").on(t.locationId),
    /** One row per entry per place. */
    uniqueIndex("stock_place_idx").on(
      t.itemId,
      t.locationId,
      t.status,
      sql`ifnull(${t.robotId}, 0)`,
      sql`ifnull(${t.subsystemId}, 0)`,
    ),
  ],
);

/** Everything done to an entry, for its History. */
export const itemEvents = sqliteTable(
  "item_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /**
     * "created", "edited", "added", "counted", "moved", "checked_out", "checked_in", "received",
     * "linked", "unlinked", "merged", "split".
     */
    action: text("action").notNull(),
    note: text("note"),
    /** What the line is about elsewhere, for a link: "orders:request:12", or "item:7". */
    ref: text("ref"),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("item_events_item_idx").on(t.itemId)],
);

/**
 * What other apps have sent in (Orders, when a part is received), so the same delivery is never
 * added twice. `sourceKey` names it there ("orders:request:<id>").
 */
export const intakeReceipts = sqliteTable(
  "intake_receipts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceKey: text("source_key").notNull(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("intake_receipts_source_idx").on(t.sourceKey)],
);
