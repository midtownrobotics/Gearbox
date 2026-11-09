-- Temporary export receipts contain fingerprints and file references, not duplicate file data.
CREATE TABLE season_exports (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  year INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, id),
  UNIQUE (team_id)
);
CREATE INDEX season_exports_expiry ON season_exports(expires_at);
CREATE TABLE season_export_parts (
  team_id TEXT NOT NULL,
  export_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  archive_hash TEXT,
  archive_size INTEGER,
  resetting_at INTEGER,
  result_json TEXT,
  PRIMARY KEY (team_id, export_id, part),
  FOREIGN KEY (team_id, export_id) REFERENCES season_exports(team_id, id) ON DELETE CASCADE
);
