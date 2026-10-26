-- Notifications come in two types now, Informational and Critical: warnings (downtime, version
-- changes) become Informational. And a team's admins can write notifications for their own team
-- (`team_id`); the operators' ones for every team have none. The types are a CHECK in both tables'
-- definitions, so both are rebuilt (the settings with a new key); nothing points at them.
CREATE TABLE notifications_new (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('info', 'critical')),
  -- The team that wrote it, for its own members; null for an operator's, for every team.
  team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Who wrote it (G3ID's user id): an operator, or one of the team's admins.
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO notifications_new (id, type, team_id, summary, body, expires_at, created_by, created_at)
SELECT id, CASE WHEN type = 'warning' THEN 'info' ELSE type END, NULL, summary, body, expires_at,
  created_by, created_at
FROM notifications;
DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;
CREATE INDEX notifications_created_at_idx ON notifications (created_at);
CREATE INDEX notifications_team_id_idx ON notifications (team_id, created_at);

-- Each team's settings are now per source as well as per type: Gearbox's notifications and the
-- team's own are set apart, and only Gearbox's Critical ones are DMed. The old rows become
-- Gearbox's: a team's Warning settings join its Informational ones (the wider home page audience,
-- the Informational channel, else the Warning one), and Critical keeps its DMs. The team's own
-- start with no row (everyone sees them on the home page).
CREATE TABLE team_notification_settings_new (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- Whose notifications: 'gearbox' (the operators') or 'team' (its admins').
  source TEXT NOT NULL CHECK (source IN ('gearbox', 'team')),
  type TEXT NOT NULL CHECK (type IN ('info', 'critical')),
  portal TEXT NOT NULL CHECK (portal IN ('everyone', 'admins', 'nobody')),
  -- A channel's id on the team's chat (Slack or Discord), if any.
  channel TEXT,
  -- JSON array: G3ID user ids to DM; only Gearbox's Critical ones are DMed.
  dm_users TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (team_id, source, type)
);
INSERT INTO team_notification_settings_new
  (team_id, source, type, portal, channel, dm_users, updated_at, updated_by)
SELECT team_id, 'gearbox', 'critical', portal, slack_channel, slack_users, updated_at, updated_by
FROM team_notification_settings
WHERE type = 'critical';
INSERT INTO team_notification_settings_new
  (team_id, source, type, portal, channel, dm_users, updated_at, updated_by)
SELECT
  t.team_id,
  'gearbox',
  'info',
  CASE
    WHEN 'everyone' IN (i.portal, w.portal) THEN 'everyone'
    WHEN 'admins' IN (i.portal, w.portal) THEN 'admins'
    ELSE 'nobody'
  END,
  COALESCE(i.slack_channel, w.slack_channel),
  '[]',
  MAX(COALESCE(i.updated_at, 0), COALESCE(w.updated_at, 0)),
  COALESCE(i.updated_by, w.updated_by)
FROM (
  SELECT DISTINCT team_id FROM team_notification_settings WHERE type IN ('info', 'warning')
) t
LEFT JOIN team_notification_settings i ON i.team_id = t.team_id AND i.type = 'info'
LEFT JOIN team_notification_settings w ON w.team_id = t.team_id AND w.type = 'warning';
DROP TABLE team_notification_settings;
ALTER TABLE team_notification_settings_new RENAME TO team_notification_settings;
