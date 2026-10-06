-- Fees on a vendor order (shipping, tax, tariff, ...) as charged to each budget category. New
-- orders split them by item cost; imported orders keep the order sheet's own allocation.
CREATE TABLE order_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES vendor_orders(id),
  kind TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES budget_categories(id),
  cents INTEGER NOT NULL
);
CREATE INDEX order_charges_order_idx ON order_charges (order_id);

-- A line's exact total when it isn't quantity x unit price (rounded unit prices on the sheet).
ALTER TABLE order_requests ADD COLUMN line_total_cents INTEGER;
-- Fingerprint of the order-sheet row a line was imported from, so re-imports skip it.
ALTER TABLE order_requests ADD COLUMN import_key TEXT;
CREATE UNIQUE INDEX order_requests_import_key_idx ON order_requests (import_key);
