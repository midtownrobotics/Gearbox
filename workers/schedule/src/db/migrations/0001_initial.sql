-- Schedule: the team's meetings, events and deadlines.
--
-- Everything here is one team's data (team_id), and every query goes through inTeam/withTeam from
-- @g3/auth (roadmap Phase 3).

-- One thing on the team's calendar. Times are Unix seconds; an event without an end is a moment
-- (a deadline).
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  -- G3ID user id.
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX events_team_starts_idx ON events(team_id, starts_at);
