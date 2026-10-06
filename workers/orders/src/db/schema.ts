import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** What a purchase is charged against. Mentors manage these; archived ones can't take new requests. */
export const budgetCategories = sqliteTable("budget_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  /** Allocated budget in cents; null when the category just tracks spending. */
  budgetCents: integer("budget_cents"),
  /** Accounting code used in exports (e.g. "4101"); exports fall back to the name. */
  code: text("code"),
  isArchived: integer("is_archived").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

/**
 * A placed order with one vendor. Its lines are the order_requests pointing at it (their quantity
 * and unit price are the final, as-ordered values). Shipping and tax are split across the lines'
 * budget categories in proportion to each category's item cost.
 */
export const vendorOrders = sqliteTable("vendor_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vendor: text("vendor").notNull(),
  placedById: text("placed_by_id").notNull(),
  placedByName: text("placed_by_name").notNull(),
  shippingCents: integer("shipping_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  tracking: text("tracking"),
  placedAt: integer("placed_at").notNull(),
});

/** A fee on a vendor order (Shipping, Tax, Tariff, ...) as charged to one budget category. */
export const orderCharges = sqliteTable(
  "order_charges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id")
      .notNull()
      .references(() => vendorOrders.id),
    kind: text("kind").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => budgetCategories.id),
    cents: integer("cents").notNull(),
  },
  (t) => [index("order_charges_order_idx").on(t.orderId)],
);

export const PRIORITIES = ["blocking", "high", "normal", "nice"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** A category's budget for one fiscal year (July–June; 2026 = July 2026–June 2027). */
export const categoryBudgets = sqliteTable(
  "category_budgets",
  {
    categoryId: integer("category_id")
      .notNull()
      .references(() => budgetCategories.id),
    fiscalYear: integer("fiscal_year").notNull(),
    budgetCents: integer("budget_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.fiscalYear] })],
);

/** A vendor's purchasing profile, keyed by the lowercased vendor name requests use. */
export const vendors = sqliteTable("vendors", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  taxExempt: integer("tax_exempt").notNull().default(0),
  taxExemptExpires: integer("tax_exempt_expires"),
  /** "Sign in to the team account before checkout" (needed for tax exemption, saved addresses). */
  teamAccountLogin: integer("team_account_login").notNull().default(0),
  freeShippingCents: integer("free_shipping_cents"),
  typicalShippingCents: integer("typical_shipping_cents"),
  minimumOrderCents: integer("minimum_order_cents"),
  leadTimeDays: integer("lead_time_days"),
  shippingDays: integer("shipping_days"),
  orderCutoff: text("order_cutoff"),
  paymentMethod: text("payment_method"),
  accountOwner: text("account_owner"),
  notes: text("notes"),
  defaultCategoryId: integer("default_category_id").references(() => budgetCategories.id),
  updatedAt: integer("updated_at").notNull(),
});

export const CREDIT_KINDS = ["voucher", "credit", "discount"] as const;

/** Vouchers, store credit and sponsor discount codes for a vendor. */
export const vendorCredits = sqliteTable(
  "vendor_credits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vendorKey: text("vendor_key").notNull(),
    kind: text("kind", { enum: CREDIT_KINDS }).notNull(),
    label: text("label").notNull(),
    code: text("code"),
    balanceCents: integer("balance_cents"),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("vendor_credits_vendor_idx").on(t.vendorKey)],
);

export const REQUEST_STATUSES = [
  "requested",
  "approved",
  "denied",
  "ordered",
  "received",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** One line someone wants bought: a vendor link, a quantity, and why. */
export const orderRequests = sqliteTable(
  "order_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requesterId: text("requester_id").notNull(),
    requesterName: text("requester_name").notNull(),
    /** The requester's linked Slack user, captured at submit time, for notifications. */
    requesterSlackId: text("requester_slack_id"),
    url: text("url").notNull(),
    vendor: text("vendor").notNull(),
    title: text("title").notNull(),
    sku: text("sku"),
    /** The chosen option (size, pack, color) when the product has variants. */
    variant: text("variant"),
    image: text("image"),
    /** Estimated price of one unit, in cents (from the lookup, or entered by hand). */
    unitPriceCents: integer("unit_price_cents"),
    currency: text("currency").notNull().default("USD"),
    quantity: integer("quantity").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => budgetCategories.id),
    reason: text("reason").notNull(),
    status: text("status", { enum: REQUEST_STATUSES }).notNull().default("requested"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("normal"),
    /** When it's needed (ms, a day in Eastern time); null when there's no deadline. */
    needBy: integer("need_by"),
    /** Unused since vendor orders (0003); placed lines' final qty/price are quantity/unitPriceCents. */
    actualCostCents: integer("actual_cost_cents"),
    /** The vendor order this line was placed in. */
    orderId: integer("order_id").references(() => vendorOrders.id),
    /** Exact line total when it isn't quantity × unit price (imported rows with rounded prices). */
    lineTotalCents: integer("line_total_cents"),
    /** The platform the lookup detected ("shopify", "amazon", ...), for one-click carts. */
    storePlatform: text("store_platform"),
    /** The store's id for the chosen option (a Shopify variant id). */
    storeVariantId: text("store_variant_id"),
    /** The catalog item this line is (set when it's submitted; new links join the catalog). */
    catalogItemId: integer("catalog_item_id"),
    /** Fingerprint of the order-sheet row this was imported from (re-imports skip it). */
    importKey: text("import_key").unique(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("order_requests_status_idx").on(t.status),
    index("order_requests_requester_idx").on(t.requesterId),
  ],
);

/** Every status change and edit, with who did it and an optional note (e.g. why it was denied). */
export const requestEvents = sqliteTable(
  "request_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: integer("request_id")
      .notNull()
      .references(() => orderRequests.id),
    userId: text("user_id").notNull(),
    userName: text("user_name").notNull(),
    /** "created", "edited", or the status moved to. */
    action: text("action").notNull(),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("request_events_request_idx").on(t.requestId)],
);

/** Part lookup results by normalized URL (JSON PartLookup), reused for 7 days. */
export const lookupCache = sqliteTable("lookup_cache", {
  url: text("url").primaryKey(),
  result: text("result").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

/** Team-wide settings, one value per key (e.g. "naming_template"). */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** A keyword that suggests a budget category for new requests whose name contains it. */
export const categoryRules = sqliteTable("category_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  keyword: text("keyword").notNull(),
  categoryId: integer("category_id")
    .notNull()
    .references(() => budgetCategories.id),
  createdAt: integer("created_at").notNull(),
});

/** A product family from the FRCDesign library (one part in its sizes and types). */
export const catalogFamilies = sqliteTable("catalog_families", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  sourceId: text("source_id").unique(),
  sourceUrl: text("source_url"),
  createdAt: integer("created_at").notNull(),
});

export const LINK_KINDS = ["product", "search", "homepage"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** One buyable part in the catalog: seeded from FRCDesign, or added by a request. */
export const catalogItems = sqliteTable(
  "catalog_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    familyId: integer("family_id").references(() => catalogFamilies.id),
    category: text("category").notNull(),
    name: text("name").notNull(),
    vendor: text("vendor").notNull(),
    sku: text("sku"),
    /** JSON object of configuration choices ({"Length": "1/2\""}). */
    options: text("options").notNull().default("{}"),
    url: text("url").notNull(),
    /** "product" page, vendor "search" for the SKU, or the vendor's "homepage". */
    linkKind: text("link_kind", { enum: LINK_KINDS }).notNull().default("product"),
    /** catalogKey() of a product link, for matching requests to items. */
    productKey: text("product_key"),
    image: text("image"),
    /** Last price paid (set when an order is placed); older than 7 days gets looked up again. */
    priceCents: integer("price_cents"),
    priceAt: integer("price_at"),
    storePlatform: text("store_platform"),
    storeVariantId: text("store_variant_id"),
    source: text("source", { enum: ["frcdesign", "request"] }).notNull(),
    sourceId: text("source_id").unique(),
    requestCount: integer("request_count").notNull().default(0),
    lastRequestedAt: integer("last_requested_at"),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
    updatedBy: text("updated_by"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("catalog_items_family_idx").on(t.familyId),
    index("catalog_items_product_key_idx").on(t.productKey),
  ],
);

/** The catalog's categories; parts must be in one. Trusted students and mentors add them. */
export const catalogCategories = sqliteTable("catalog_categories", {
  name: text("name").primaryKey(),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull(),
});

/** People who have opened G3 Orders; mentors mark trusted students (catalog editors). */
export const appUsers = sqliteTable("app_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  trusted: integer("trusted").notNull().default(0),
  trustedBy: text("trusted_by"),
  trustedAt: integer("trusted_at"),
  lastSeenAt: integer("last_seen_at").notNull(),
});

/** A named list of requests (a mechanism's parts, a restock, ...) to follow together. */
export const partLists = sqliteTable("part_lists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  createdById: text("created_by_id").notNull(),
  createdByName: text("created_by_name").notNull(),
  isArchived: integer("is_archived").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** A request on a list. A request can be on several lists. */
export const partListItems = sqliteTable(
  "part_list_items",
  {
    listId: integer("list_id")
      .notNull()
      .references(() => partLists.id, { onDelete: "cascade" }),
    requestId: integer("request_id")
      .notNull()
      .references(() => orderRequests.id),
    addedByName: text("added_by_name").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.requestId] }),
    index("part_list_items_request_idx").on(t.requestId),
  ],
);
