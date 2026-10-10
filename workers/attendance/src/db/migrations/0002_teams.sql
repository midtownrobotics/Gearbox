-- Attendance serves many teams (roadmap Phase 3). Every table carries the team. The records here
-- are the site's own team's (the only team before Phase 3), so they're filled in with its id, as
-- G3ID's teams migration (0013) did. SQLite can't add a NOT NULL column without a default; the
-- app always sets team_id, and the default is never left on a row.
-- Member ids are made from a G3ID user id, which is unique across teams, so no key needs a rebuild.

ALTER TABLE attendance_members ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE attendance_sessions ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
ALTER TABLE attendance_totals ADD COLUMN team_id TEXT NOT NULL DEFAULT '';
UPDATE attendance_members SET team_id = 'frc1648' WHERE team_id = '';
UPDATE attendance_sessions SET team_id = 'frc1648' WHERE team_id = '';
UPDATE attendance_totals SET team_id = 'frc1648' WHERE team_id = '';

CREATE INDEX attendance_members_team_idx ON attendance_members (team_id);
CREATE INDEX attendance_sessions_team_status_idx ON attendance_sessions (team_id, status);

-- A team's settings (until Phase 4's dashboard, edited on G3ID's Attendance admin page). A team
-- without a row gets the defaults in src/settings.ts. The site's team keeps the values that were
-- in code: the school year starts on 3 August, and sessions close after 12 hours.
CREATE TABLE attendance_settings (
  team_id TEXT PRIMARY KEY NOT NULL,
  school_year_start_month INTEGER NOT NULL CHECK (school_year_start_month BETWEEN 1 AND 12),
  school_year_start_day INTEGER NOT NULL CHECK (school_year_start_day BETWEEN 1 AND 31),
  auto_sign_out_hours INTEGER NOT NULL CHECK (auto_sign_out_hours BETWEEN 1 AND 24),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by TEXT
);
INSERT INTO attendance_settings (team_id, school_year_start_month, school_year_start_day, auto_sign_out_hours)
VALUES ('frc1648', 8, 3, 12);
