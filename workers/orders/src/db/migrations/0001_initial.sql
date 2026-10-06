CREATE TABLE budget_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  budget_cents INTEGER,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

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
    CHECK (status IN ('requested', 'approved', 'denied', 'ordered', 'received', 'cancelled')),
  actual_cost_cents INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX order_requests_status_idx ON order_requests (status);
CREATE INDEX order_requests_requester_idx ON order_requests (requester_id);

CREATE TABLE request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES order_requests(id),
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX request_events_request_idx ON request_events (request_id);
