-- Temporary upload coordination; no member data or stored-file accounting.
CREATE TABLE storage_upload_locks (
  team_id TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
