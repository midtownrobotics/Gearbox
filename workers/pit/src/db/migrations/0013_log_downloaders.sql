-- Log downloaders: computers running the pit log downloader (devices/pit-log-downloader) that
-- the team has paired with its Pit. Each has its own key, shown once to the downloader when it
-- pairs; only the key's SHA-256 is kept.

CREATE TABLE log_downloaders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  paired_by TEXT NOT NULL,
  paired_by_name TEXT NOT NULL,
  paired_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE UNIQUE INDEX log_downloaders_key_idx ON log_downloaders (team_id, key_hash);

-- Pairing codes: a mentor or admin gets one on Pit's Logs page and types it into the downloader.
-- A team has at most one at a time (a new one replaces it); it lasts 10 minutes, works once and
-- stops working after 5 wrong guesses.
CREATE TABLE log_downloader_codes (
  team_id TEXT NOT NULL,
  code TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, code)
);
