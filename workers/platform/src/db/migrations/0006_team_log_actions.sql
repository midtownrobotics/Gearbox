-- Two more kinds of line in a team's log: a big settings change in one of its apps
-- ('settings_changed': which app, what and which fields, never their values) and a download of
-- an app's data ('app_exported', offered before switching an app off). The allowed actions are a
-- CHECK in the table's definition, so the table is rebuilt; nothing points at it.
CREATE TABLE team_audit_log_new (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT,
  action TEXT NOT NULL CHECK (
    action IN ('app_enabled', 'app_disabled', 'app_data_deleted', 'app_exported', 'settings_changed')
  ),
  app TEXT,
  -- JSON.
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
INSERT INTO team_audit_log_new (id, team_id, user_id, action, app, details, created_at)
SELECT id, team_id, user_id, action, app, details, created_at FROM team_audit_log;
DROP TABLE team_audit_log;
ALTER TABLE team_audit_log_new RENAME TO team_audit_log;
CREATE INDEX team_audit_log_team_idx ON team_audit_log (team_id, created_at);
