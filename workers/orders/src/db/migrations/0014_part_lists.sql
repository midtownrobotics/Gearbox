-- Lists of requests (a mechanism's parts, a competition restock, ...) so people can follow how
-- many are approved, ordered and here. A request can be on several lists; removing it from a list
-- or deleting the list never touches the request itself.

CREATE TABLE part_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_by_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE part_list_items (
  list_id INTEGER NOT NULL REFERENCES part_lists(id) ON DELETE CASCADE,
  request_id INTEGER NOT NULL REFERENCES order_requests(id),
  added_by_name TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (list_id, request_id)
);
CREATE INDEX part_list_items_request_idx ON part_list_items(request_id);
