CREATE TABLE team_storage_policy (
  team_id TEXT PRIMARY KEY NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  automatic_deletion INTEGER NOT NULL DEFAULT 1 CHECK (automatic_deletion IN (0, 1)),
  updated_at INTEGER NOT NULL
);
