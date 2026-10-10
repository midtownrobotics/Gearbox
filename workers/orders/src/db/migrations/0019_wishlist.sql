-- The wishlist: parts someone would like one day, kept in order_requests with the status
-- 'wishlist' until anyone promotes one to a real request ('requested'). The status CHECK is part of
-- the table's definition, so the table is rebuilt: copied aside, dropped, created again under the
-- same name (request_events and part_list_items point at it) and filled back, with the
-- foreign-key checks deferred to the end, as 0018 did for the tables it rebuilt. Same columns, in
-- the same order, with the same defaults and references; only the CHECK gains 'wishlist'.
PRAGMA defer_foreign_keys = true;

CREATE TABLE order_requests_old AS SELECT * FROM order_requests;
DROP TABLE order_requests;
CREATE TABLE order_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_id TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  requester_slack_id TEXT,
  url TEXT NOT NULL,
  vendor TEXT NOT NULL,
  title TEXT NOT NULL,
  sku TEXT,
  variant TEXT,
  image TEXT,
  unit_price_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  quantity INTEGER NOT NULL,
  category_id INTEGER NOT NULL REFERENCES budget_categories(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('wishlist', 'requested', 'approved', 'denied', 'ordered', 'received', 'cancelled')),
  actual_cost_cents INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  order_id INTEGER REFERENCES vendor_orders(id),
  line_total_cents INTEGER,
  import_key TEXT,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('blocking', 'high', 'normal', 'nice')),
  need_by INTEGER,
  store_platform TEXT,
  store_variant_id TEXT,
  catalog_item_id INTEGER REFERENCES catalog_items(id),
  pack_quantity INTEGER NOT NULL DEFAULT 1,
  inventory_location_id INTEGER,
  team_id TEXT NOT NULL DEFAULT ''
);
INSERT INTO order_requests (
  id, requester_id, requester_name, requester_slack_id, url, vendor, title, sku, variant, image,
  unit_price_cents, currency, quantity, category_id, reason, status, actual_cost_cents,
  created_at, updated_at, order_id, line_total_cents, import_key, priority, need_by,
  store_platform, store_variant_id, catalog_item_id, pack_quantity, inventory_location_id, team_id
)
SELECT
  id, requester_id, requester_name, requester_slack_id, url, vendor, title, sku, variant, image,
  unit_price_cents, currency, quantity, category_id, reason, status, actual_cost_cents,
  created_at, updated_at, order_id, line_total_cents, import_key, priority, need_by,
  store_platform, store_variant_id, catalog_item_id, pack_quantity, inventory_location_id, team_id
FROM order_requests_old;
DROP TABLE order_requests_old;

CREATE INDEX order_requests_requester_idx ON order_requests (requester_id);
CREATE INDEX order_requests_order_idx ON order_requests (order_id);
CREATE UNIQUE INDEX order_requests_import_key_idx ON order_requests (team_id, import_key);
CREATE INDEX order_requests_status_idx ON order_requests (team_id, status);
