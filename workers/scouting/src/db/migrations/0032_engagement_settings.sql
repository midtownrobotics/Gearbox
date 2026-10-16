CREATE TABLE scouting_engagement_settings (
  team_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  predictions_enabled INTEGER NOT NULL DEFAULT 1 CHECK (predictions_enabled IN (0, 1)),
  combinations_enabled INTEGER NOT NULL DEFAULT 0 CHECK (combinations_enabled IN (0, 1)),
  leaderboard_enabled INTEGER NOT NULL DEFAULT 0 CHECK (leaderboard_enabled IN (0, 1)),
  points_label TEXT NOT NULL DEFAULT 'Scout Points',
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
