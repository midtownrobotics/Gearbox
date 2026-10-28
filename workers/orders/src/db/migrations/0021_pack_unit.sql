-- Pack unit: what a pack quantity counts, when it isn't one of each: a 100 ft spool of wire is a
-- pack of 100 in "ft", and received, it's 100 ft in the Inventory app. Empty for one of each, so
-- every part and request that was here before stays as it was. On the catalog part and copied
-- onto each request, like pack_quantity (0016).
ALTER TABLE catalog_items ADD COLUMN pack_unit TEXT NOT NULL DEFAULT '';
ALTER TABLE order_requests ADD COLUMN pack_unit TEXT NOT NULL DEFAULT '';
