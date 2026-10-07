-- Inventory: what a team owns, where it is, and what's on a robot.
--
-- Everything here is one team's data, and none of it is in this file: a team defines its own
-- fields, locations, robots and subsystems on the Settings page, or loads them from a setup file
-- (src/lib/setup.ts). Ids are row numbers and nothing is unique by name across a table (names are
-- checked among siblings in code), so a team column can be added later without rebuilding tables
-- (roadmap Phase 3).

-- What a team records about a part, beyond its name. Admins define these.
CREATE TABLE fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN ('text', 'paragraph', 'number', 'choice', 'checkbox', 'link', 'date')),
  -- For a choice field: the JSON list of choices.
  options TEXT NOT NULL DEFAULT '[]',
  -- Whether the main table has a column for it.
  show_in_table INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Where things are kept: a tree, at most four levels deep (checked in code).
CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES locations(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX locations_parent_idx ON locations(parent_id);

-- What a part in use is in use on.
CREATE TABLE robots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE subsystems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- An inventory entry: one kind of part, whichever vendors it comes from.
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  -- JSON object of the team's fields: field id -> value.
  field_values TEXT NOT NULL DEFAULT '{}',
  created_by_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A way to buy an entry: one vendor's SKU. Equivalent parts from several vendors are several
-- listings on one entry. `catalog_item_id` is the part's id in Orders' catalog when it's linked to
-- one; the rest is copied from there (or typed in) so it shows without Orders.
CREATE TABLE item_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  catalog_item_id INTEGER,
  vendor TEXT NOT NULL DEFAULT '',
  sku TEXT,
  name TEXT NOT NULL DEFAULT '',
  url TEXT,
  price_cents INTEGER,
  price_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX item_listings_item_idx ON item_listings(item_id);
CREATE INDEX item_listings_catalog_idx ON item_listings(catalog_item_id);

-- How many of an entry are in one place. In storage, that's a location. In use, it's a location
-- and the robot and subsystem it's in use on. A row is kept at zero when everything moves out of
-- it, so the entry remembers where it lives.
CREATE TABLE stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  status TEXT NOT NULL,
  robot_id INTEGER REFERENCES robots(id),
  subsystem_id INTEGER REFERENCES subsystems(id),
  -- Never below zero: taking out more than is there fails, and the whole change with it.
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  -- When someone last counted this row, and who.
  counted_at INTEGER,
  counted_by_name TEXT,
  updated_at INTEGER NOT NULL,
  CHECK (
    (status = 'storage' AND robot_id IS NULL AND subsystem_id IS NULL)
    OR (status = 'in_use' AND robot_id IS NOT NULL AND subsystem_id IS NOT NULL)
  )
);
CREATE INDEX stock_item_idx ON stock(item_id);
CREATE INDEX stock_location_idx ON stock(location_id);
-- One row per entry per place.
CREATE UNIQUE INDEX stock_place_idx
  ON stock(item_id, location_id, status, ifnull(robot_id, 0), ifnull(subsystem_id, 0));

-- Everything done to an entry, for its History.
CREATE TABLE item_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  -- "created", "edited", "added", "counted", "moved", "checked_out", "checked_in", "received",
  -- "linked", "unlinked", "merged", "split".
  action TEXT NOT NULL,
  note TEXT,
  -- What the line is about elsewhere, for a link: "orders:request:12", or "item:7" (another entry).
  ref TEXT,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX item_events_item_idx ON item_events(item_id);

-- What other apps have sent in (Orders, when a part is received), so the same delivery is never
-- added twice. `source_key` names it there ("orders:request:<id>"), and is unique for every team:
-- Orders numbers its requests across all of them.
CREATE TABLE intake_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX intake_receipts_source_idx ON intake_receipts(source_key);
