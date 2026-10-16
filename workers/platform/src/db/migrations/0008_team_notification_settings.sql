-- Where each team wants the platform's notifications (0007), one row per team and type: who sees
-- them on the team's home page, and the Slack channel and members (G3ID user ids) they're sent
-- to. A type without a row shows to admins on the home page and goes nowhere on Slack.
CREATE TABLE team_notification_settings (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('info', 'warning', 'critical')),
  portal TEXT NOT NULL CHECK (portal IN ('everyone', 'admins', 'nobody')),
  -- The Slack channel's id, if any.
  slack_channel TEXT,
  -- JSON array: G3ID user ids to DM.
  slack_users TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (team_id, type)
);
