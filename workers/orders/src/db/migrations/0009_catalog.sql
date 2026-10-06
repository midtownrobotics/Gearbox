-- Product catalog: parts anyone can search and request from. Seeded from the FRCDesign library
-- export (0010), then grows as requests bring in links it doesn't have yet.

CREATE TABLE catalog_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  -- FRCDesign family id and page, for families from the library.
  source_id TEXT UNIQUE,
  source_url TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id INTEGER REFERENCES catalog_families(id),
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL,
  sku TEXT,
  -- JSON object of configuration choices, e.g. {"Head Type":"Button","Length":"1/2\""}.
  options TEXT NOT NULL DEFAULT '{}',
  url TEXT NOT NULL,
  -- 'product' (the product page), 'search' (vendor search for the SKU) or 'homepage'.
  link_kind TEXT NOT NULL DEFAULT 'product',
  -- productKey() of a product link (host + path [+ variant]), for matching requests to items.
  product_key TEXT,
  image TEXT,
  -- Last price paid, set when an order is placed; older than 7 days means look it up again.
  price_cents INTEGER,
  price_at INTEGER,
  store_platform TEXT,
  store_variant_id TEXT,
  -- 'frcdesign' (seeded) or 'request' (added by someone's request).
  source TEXT NOT NULL,
  source_id TEXT UNIQUE,
  request_count INTEGER NOT NULL DEFAULT 0,
  last_requested_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX catalog_items_family_idx ON catalog_items(family_id);
CREATE INDEX catalog_items_product_key_idx ON catalog_items(product_key);

ALTER TABLE order_requests ADD COLUMN catalog_item_id INTEGER REFERENCES catalog_items(id);
