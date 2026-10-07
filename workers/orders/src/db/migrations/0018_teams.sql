-- Orders serves many teams (roadmap Phase 3). Every table but the lookup cache carries the team,
-- and every query is kept to it (inTeam/withTeam from @g3/auth). What's here is the site's own
-- team's (the only team before Phase 3), so it's filled in with that team's id, as G3ID's teams
-- migration (0013) did. SQLite can't add a NOT NULL column without a default; the app always sets
-- team_id, and the default is never left on a row.
--
-- Keys that were unique across the table are now unique within a team: budget category names,
-- vendor keys, setting keys, catalog category names, FRCDesign source ids and order-sheet import
-- keys. Tables with those in their definition are rebuilt. Rebuilt tables that other tables point
-- at (budget_categories, catalog_families, catalog_items) are copied aside, dropped, created again
-- under the same name and filled back, with the foreign-key checks deferred to the end: D1 ignores
-- `PRAGMA foreign_keys = OFF` in a migration, and only rows put back under the real name clear the
-- failures the drop leaves (G3ID 0013 does the same).
--
-- lookup_cache stays shared: it holds vendors' public product pages by link, for any team.
PRAGMA defer_foreign_keys = true;

-- Budget categories: names unique within a team.
CREATE TABLE budget_categories_old AS SELECT * FROM budget_categories;
DROP TABLE budget_categories;
CREATE TABLE budget_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  budget_cents INTEGER,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  code TEXT,
  UNIQUE (team_id, name)
);
INSERT INTO budget_categories (id, team_id, name, budget_cents, is_archived, created_at, code)
SELECT id, 'frc1648', name, budget_cents, is_archived, created_at, code FROM budget_categories_old;
DROP TABLE budget_categories_old;

-- The catalog: FRCDesign source ids unique within a team.
CREATE TABLE catalog_families_old AS SELECT * FROM catalog_families;
CREATE TABLE catalog_items_old AS SELECT * FROM catalog_items;
DROP TABLE catalog_items;
DROP TABLE catalog_families;
CREATE TABLE catalog_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  -- FRCDesign family id and page, for families from the library.
  source_id TEXT,
  source_url TEXT,
  created_at INTEGER NOT NULL
);
INSERT INTO catalog_families (id, team_id, name, category, source_id, source_url, created_at)
SELECT id, 'frc1648', name, category, source_id, source_url, created_at FROM catalog_families_old;
DROP TABLE catalog_families_old;
CREATE UNIQUE INDEX catalog_families_source_idx ON catalog_families (team_id, source_id);
CREATE INDEX catalog_families_team_idx ON catalog_families (team_id);

CREATE TABLE catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
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
  -- catalogKey() of a product link (host + path [+ variant]), for matching requests to items.
  product_key TEXT,
  image TEXT,
  -- Last price this team paid, set when it places an order; older than 7 days is looked up again.
  price_cents INTEGER,
  price_at INTEGER,
  store_platform TEXT,
  store_variant_id TEXT,
  -- 'frcdesign' (from the starter catalog) or 'request' (added by someone's request).
  source TEXT NOT NULL,
  source_id TEXT,
  request_count INTEGER NOT NULL DEFAULT 0,
  last_requested_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  pack_quantity INTEGER NOT NULL DEFAULT 1
);
INSERT INTO catalog_items (id, team_id, family_id, category, name, vendor, sku, options, url,
                           link_kind, product_key, image, price_cents, price_at, store_platform,
                           store_variant_id, source, source_id, request_count, last_requested_at,
                           created_by, created_at, updated_by, updated_at, pack_quantity)
SELECT id, 'frc1648', family_id, category, name, vendor, sku, options, url, link_kind, product_key,
       image, price_cents, price_at, store_platform, store_variant_id, source, source_id,
       request_count, last_requested_at, created_by, created_at, updated_by, updated_at,
       pack_quantity
FROM catalog_items_old;
DROP TABLE catalog_items_old;
CREATE UNIQUE INDEX catalog_items_source_idx ON catalog_items (team_id, source_id);
CREATE INDEX catalog_items_team_idx ON catalog_items (team_id, name);
CREATE INDEX catalog_items_family_idx ON catalog_items (family_id);
CREATE INDEX catalog_items_product_key_idx ON catalog_items (team_id, product_key);

-- Catalog categories: names unique within a team.
CREATE TABLE catalog_categories_new (
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, name)
);
INSERT INTO catalog_categories_new (team_id, name, created_by, created_at)
SELECT 'frc1648', name, created_by, created_at FROM catalog_categories;
DROP TABLE catalog_categories;
ALTER TABLE catalog_categories_new RENAME TO catalog_categories;

-- Vendor profiles: keyed by team and lowercased name.
CREATE TABLE vendors_new (
  team_id TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  tax_exempt INTEGER NOT NULL DEFAULT 0,
  tax_exempt_expires INTEGER,
  team_account_login INTEGER NOT NULL DEFAULT 0,
  free_shipping_cents INTEGER,
  typical_shipping_cents INTEGER,
  minimum_order_cents INTEGER,
  lead_time_days INTEGER,
  shipping_days INTEGER,
  order_cutoff TEXT,
  payment_method TEXT,
  account_owner TEXT,
  notes TEXT,
  default_category_id INTEGER REFERENCES budget_categories(id),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, key)
);
INSERT INTO vendors_new (team_id, key, name, tax_exempt, tax_exempt_expires, team_account_login,
                         free_shipping_cents, typical_shipping_cents, minimum_order_cents,
                         lead_time_days, shipping_days, order_cutoff, payment_method,
                         account_owner, notes, default_category_id, updated_at)
SELECT 'frc1648', key, name, tax_exempt, tax_exempt_expires, team_account_login,
       free_shipping_cents, typical_shipping_cents, minimum_order_cents, lead_time_days,
       shipping_days, order_cutoff, payment_method, account_owner, notes, default_category_id,
       updated_at
FROM vendors;
DROP TABLE vendors;
ALTER TABLE vendors_new RENAME TO vendors;

-- Settings: keyed by team and name.
CREATE TABLE app_settings_new (
  team_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (team_id, key)
);
INSERT INTO app_settings_new (team_id, key, value)
SELECT 'frc1648', key, value FROM app_settings;
DROP TABLE app_settings;
ALTER TABLE app_settings_new RENAME TO app_settings;

-- Order-sheet rows imported once per team.
ALTER TABLE order_requests ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
UPDATE order_requests SET team_id = 'frc1648' WHERE team_id = '';
DROP INDEX order_requests_import_key_idx;
CREATE UNIQUE INDEX order_requests_import_key_idx ON order_requests (team_id, import_key);
DROP INDEX order_requests_status_idx;
CREATE INDEX order_requests_status_idx ON order_requests (team_id, status);

-- The rest only gain the team.
ALTER TABLE request_events ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE vendor_orders ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE order_charges ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE category_budgets ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE vendor_credits ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE category_rules ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE app_users ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE part_lists ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE part_list_items ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
UPDATE request_events SET team_id = 'frc1648' WHERE team_id = '';
UPDATE vendor_orders SET team_id = 'frc1648' WHERE team_id = '';
UPDATE order_charges SET team_id = 'frc1648' WHERE team_id = '';
UPDATE category_budgets SET team_id = 'frc1648' WHERE team_id = '';
UPDATE vendor_credits SET team_id = 'frc1648' WHERE team_id = '';
UPDATE category_rules SET team_id = 'frc1648' WHERE team_id = '';
UPDATE app_users SET team_id = 'frc1648' WHERE team_id = '';
UPDATE part_lists SET team_id = 'frc1648' WHERE team_id = '';
UPDATE part_list_items SET team_id = 'frc1648' WHERE team_id = '';
CREATE INDEX vendor_orders_team_idx ON vendor_orders (team_id, placed_at);
CREATE INDEX category_budgets_team_idx ON category_budgets (team_id, fiscal_year);
DROP INDEX vendor_credits_vendor_idx;
CREATE INDEX vendor_credits_vendor_idx ON vendor_credits (team_id, vendor_key);
CREATE INDEX category_rules_team_idx ON category_rules (team_id);
CREATE INDEX app_users_team_idx ON app_users (team_id);
CREATE INDEX part_lists_team_idx ON part_lists (team_id);

-- G3's fiscal year and money, which were fixed in code (lib/settings.ts has a new team's
-- defaults). There's no time zone: dates are the local time of whoever is looking.
INSERT INTO app_settings (team_id, key, value) VALUES
  ('frc1648', 'currency', 'USD'),
  ('frc1648', 'fiscal_year_start', '7');

-- The starter catalog every new team gets a copy of the first time it opens Orders
-- (lib/starter.ts): the FRCDesign parts, as G3's catalog has them now (relinked, stock lengths,
-- pack quantities), without what's G3's own (prices paid, request counts, who edited them). It's
-- kept under the team id 'starter', which no real team has (theirs are 'frc<number>'), so no team
-- ever sees it. G3 already has its catalog.
INSERT INTO catalog_families (team_id, name, category, source_id, source_url, created_at)
SELECT 'starter', name, category, source_id, source_url, created_at
FROM catalog_families WHERE team_id = 'frc1648' AND source_id IS NOT NULL;

INSERT INTO catalog_items (team_id, family_id, category, name, vendor, sku, options, url,
                           link_kind, product_key, image, price_cents, price_at, store_platform,
                           store_variant_id, source, source_id, request_count, last_requested_at,
                           created_by, created_at, updated_by, updated_at, pack_quantity)
SELECT 'starter', starter.id, i.category, i.name, i.vendor, i.sku, i.options, i.url, i.link_kind,
       i.product_key, i.image, NULL, NULL, i.store_platform, i.store_variant_id, 'frcdesign',
       i.source_id, 0, NULL, NULL, i.created_at, NULL, i.updated_at, i.pack_quantity
FROM catalog_items i
LEFT JOIN catalog_families family ON family.id = i.family_id
LEFT JOIN catalog_families starter
  ON starter.team_id = 'starter' AND starter.source_id = family.source_id
WHERE i.team_id = 'frc1648' AND i.source = 'frcdesign';

INSERT INTO catalog_categories (team_id, name, created_by, created_at)
SELECT 'starter', category, NULL, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM (
  SELECT category FROM catalog_items WHERE team_id = 'starter'
  UNION
  SELECT category FROM catalog_families WHERE team_id = 'starter'
);

INSERT INTO app_settings (team_id, key, value)
VALUES ('frc1648', 'catalog_starter', CAST(CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS TEXT));
