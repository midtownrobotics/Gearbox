-- Pack quantity: how many parts one unit of a product is. A pack of 4 wheels is ordered, priced and
-- budgeted as 1; received, it's 4 parts in the Inventory app. 1 for anything sold singly.
-- On the catalog part (what the product is) and copied onto each request (what was ordered).
ALTER TABLE catalog_items ADD COLUMN pack_quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE order_requests ADD COLUMN pack_quantity INTEGER NOT NULL DEFAULT 1;
