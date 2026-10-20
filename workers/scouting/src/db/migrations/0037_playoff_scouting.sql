-- Playoff scouting: a team's playoff questions, kept from event to event, and each event's
-- playoff session (its alliances, the matches played, who scouts what and their reports).

CREATE TABLE playoff_forms (
  team_id TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id)
);

CREATE TABLE playoff_sessions (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('double8', 'double4')),
  status TEXT NOT NULL CHECK (status IN ('setup', 'live', 'finished')),
  alliances_json TEXT NOT NULL DEFAULT '[]',
  assign_mode TEXT NOT NULL DEFAULT 'claim' CHECK (assign_mode IN ('claim', 'auto', 'admin')),
  skip_own INTEGER NOT NULL DEFAULT 1 CHECK (skip_own IN (0, 1)),
  current_match_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, id)
);

-- At most one session being set up or running per team.
CREATE UNIQUE INDEX playoff_sessions_one_active ON playoff_sessions (team_id)
WHERE status IN ('setup', 'live');

CREATE TABLE playoff_matches (
  team_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  red_teams_json TEXT NOT NULL DEFAULT '[]',
  blue_teams_json TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER,
  winner TEXT CHECK (winner IN ('red', 'blue')),
  decided_at INTEGER,
  PRIMARY KEY (team_id, session_id, match_id),
  FOREIGN KEY (team_id, session_id) REFERENCES playoff_sessions (team_id, id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE playoff_participants (
  team_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, session_id, user_id),
  FOREIGN KEY (team_id, session_id) REFERENCES playoff_sessions (team_id, id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Who scouts what in a match: a slot is "red:overall", "blue:overall" or "<side>:<team number>".
CREATE TABLE playoff_claims (
  team_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  assigned_by TEXT,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, session_id, match_id, slot),
  UNIQUE (team_id, session_id, match_id, user_id),
  FOREIGN KEY (team_id, session_id) REFERENCES playoff_sessions (team_id, id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE playoff_reports (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  alliance_seed INTEGER NOT NULL,
  -- The robot scouted, or '' for the whole alliance.
  team_number TEXT NOT NULL DEFAULT '',
  answers_json TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  submitted_by_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, id),
  UNIQUE (team_id, session_id, match_id, slot, submitted_by),
  FOREIGN KEY (team_id, session_id) REFERENCES playoff_sessions (team_id, id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
