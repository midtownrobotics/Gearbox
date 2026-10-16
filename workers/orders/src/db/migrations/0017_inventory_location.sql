-- Where a request's parts went in the Inventory app when they were received: the id of a location
-- there. The next delivery of the same catalog part is offered the same place. Null when the
-- parts weren't put in Inventory.
ALTER TABLE order_requests ADD COLUMN inventory_location_id INTEGER;
