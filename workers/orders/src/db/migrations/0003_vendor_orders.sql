-- A placed order with one vendor: the final quantity/price live on its request lines; shipping and
-- tax are per order and split across the lines' budget categories in proportion to cost.
CREATE TABLE vendor_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor TEXT NOT NULL,
  placed_by_id TEXT NOT NULL,
  placed_by_name TEXT NOT NULL,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  tracking TEXT,
  placed_at INTEGER NOT NULL
);

ALTER TABLE order_requests ADD COLUMN order_id INTEGER REFERENCES vendor_orders(id);
CREATE INDEX order_requests_order_idx ON order_requests (order_id);

-- Accounting code for exports (e.g. "4101"); the name is used when it's empty.
ALTER TABLE budget_categories ADD COLUMN code TEXT;
