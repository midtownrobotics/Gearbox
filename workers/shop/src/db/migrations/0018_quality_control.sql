-- Quality Control steps: a process only the team's shop managers (and its admins) may check off,
-- after checking the part. `processes.type`'s CHECK is part of the table's definition, so the table
-- is rebuilt: copied aside, dropped, created again under the same name (four tables point at it)
-- and filled back, with the foreign-key checks deferred to the end, as 0016 did for the tables it
-- rebuilt. Same columns, in the same order, with the same defaults; only the CHECK gains
-- 'quality_control'.
PRAGMA defer_foreign_keys = true;

CREATE TABLE processes_old AS SELECT * FROM processes;
DROP TABLE processes;
CREATE TABLE processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'regular'
    CHECK (type IN ('regular', 'file_producer', 'file_consumer', 'quality_control')),
  requires_part_info INTEGER NOT NULL DEFAULT 0,
  team_id TEXT NOT NULL DEFAULT ''
);
INSERT INTO processes (id, name, created_at, type, requires_part_info, team_id)
SELECT id, name, created_at, type, requires_part_info, team_id FROM processes_old;
DROP TABLE processes_old;

CREATE INDEX processes_team_idx ON processes (team_id);

-- The team's shop managers: who may check off its Quality Control steps. One row per person, in
-- their own team; admins are allowed without a row.
CREATE TABLE shop_managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  UNIQUE (team_id, user_id)
);
CREATE INDEX shop_managers_team_idx ON shop_managers (team_id);
