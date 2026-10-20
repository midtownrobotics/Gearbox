-- Nudges: a strategy lead asked someone on scouting duty in the team's Schedule to come scout,
-- with a message from the team's bot. One row per nudge, so a person isn't nudged again too soon.
CREATE TABLE scout_nudges (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  nudged_by TEXT NOT NULL,
  nudged_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, id)
);

CREATE INDEX scout_nudges_by_person ON scout_nudges (team_id, user_id, nudged_at);
