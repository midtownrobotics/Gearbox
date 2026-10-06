-- Part lookups from the edge box, kept a week so a product crosses the shop hotspot rarely.
CREATE TABLE lookup_cache (
  url TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
