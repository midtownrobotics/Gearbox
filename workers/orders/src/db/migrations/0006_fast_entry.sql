-- Team settings (e.g. the request naming template).
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Keyword → budget category guesses for new requests ("bolt", "rivet" → Hardware).
CREATE TABLE category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES budget_categories(id),
  created_at INTEGER NOT NULL
);
