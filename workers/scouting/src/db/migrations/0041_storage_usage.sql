-- An estimate of each team's stored files, never below what's there: lets saves well under the
-- cap skip the upload lock.
CREATE TABLE storage_usage (
  team_id TEXT PRIMARY KEY NOT NULL,
  bytes INTEGER NOT NULL,
  objects INTEGER NOT NULL
);
