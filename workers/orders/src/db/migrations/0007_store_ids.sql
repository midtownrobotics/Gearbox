-- What a store's cart needs to add this line in one click: the platform the lookup detected
-- ("shopify", "amazon", ...) and the store's id for the chosen option (Shopify variant id).
ALTER TABLE order_requests ADD COLUMN store_platform TEXT;
ALTER TABLE order_requests ADD COLUMN store_variant_id TEXT;
