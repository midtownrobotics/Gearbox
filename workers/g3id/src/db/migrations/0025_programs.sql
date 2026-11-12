-- FTC teams (FRC and FTC number their teams separately): a team's id is its program and number,
-- 'frc1648' or 'ftc12345', and teams are unique by program and number, as on the platform
-- (its migration 0019). Every team here so far is FRC.
--
-- The id's CHECK and the number's UNIQUE are in the table's definition, so `teams` is rebuilt.
-- Dropping it deletes team_storage_policy's rows (ON DELETE CASCADE), so they're kept aside and
-- put back; the other tables' checks wait until the end (D1 ignores `PRAGMA foreign_keys = OFF`
-- in a migration).
PRAGMA defer_foreign_keys = true;

CREATE TABLE keep_team_storage_policy AS SELECT * FROM team_storage_policy;
CREATE TABLE keep_teams AS SELECT * FROM teams;

DROP TABLE teams;

CREATE TABLE teams (
  -- The team's key, as FIRST's sites write it: its program and number.
  id TEXT PRIMARY KEY NOT NULL CHECK (id = program || team_number),
  program TEXT NOT NULL DEFAULT 'frc' CHECK (program IN ('frc', 'ftc')),
  team_number INTEGER NOT NULL CHECK (team_number > 0),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (program, team_number)
);

INSERT INTO teams (id, program, team_number, name, created_at, updated_at)
SELECT id, 'frc', team_number, name, created_at, updated_at FROM keep_teams;
DROP TABLE keep_teams;

DELETE FROM team_storage_policy;
INSERT INTO team_storage_policy SELECT * FROM keep_team_storage_policy;
DROP TABLE keep_team_storage_policy;
