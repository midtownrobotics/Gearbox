-- Catalog categories as their own list (a new one can exist before it has parts), and the people
-- who use G3 Orders, so mentors can mark trusted students: only mentors and trusted students add
-- categories and add, edit or delete catalog parts.

CREATE TABLE catalog_categories (
  name TEXT PRIMARY KEY,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
INSERT INTO catalog_categories (name, created_at)
  SELECT DISTINCT category, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM catalog_items;

-- Everyone who has opened G3 Orders (recorded by GET /me), with the trusted flag mentors set.
CREATE TABLE app_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trusted INTEGER NOT NULL DEFAULT 0,
  trusted_by TEXT,
  trusted_at INTEGER,
  last_seen_at INTEGER NOT NULL
);
