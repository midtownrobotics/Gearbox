-- Notifications operators write in the console for every team: informational (updates, surveys),
-- warnings (downtime, version changes) and critical ones site admins should read at once. Only
-- written and listed for now; delivering them comes later.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('info', 'warning', 'critical')),
  -- A short description, a line at most.
  summary TEXT NOT NULL,
  -- The full text.
  body TEXT NOT NULL,
  -- When it stops being shown (unix seconds). Expired ones stay listed in the console.
  expires_at INTEGER NOT NULL,
  -- The operator who wrote it (G3ID's user id).
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX notifications_created_at_idx ON notifications (created_at);

-- Two more kinds of line in the operator access log: a notification written or deleted. The
-- allowed actions are a CHECK in the table's definition, so the table is rebuilt; nothing points
-- at it.
CREATE TABLE operator_actions_new (
  id TEXT PRIMARY KEY NOT NULL,
  operator_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('view_team', 'delete_team', 'renumber_team',
    'transfer_owner', 'suspend_team', 'reactivate_team', 'resolve_report', 'reopen_report',
    'add_operator', 'remove_operator', 'create_notification', 'delete_notification')),
  team_id TEXT,
  reason TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
INSERT INTO operator_actions_new (id, operator_user_id, action, team_id, reason, details, created_at)
SELECT id, operator_user_id, action, team_id, reason, details, created_at FROM operator_actions;
DROP TABLE operator_actions;
ALTER TABLE operator_actions_new RENAME TO operator_actions;
CREATE INDEX operator_actions_team_id_idx ON operator_actions(team_id);
CREATE INDEX operator_actions_created_at_idx ON operator_actions(created_at);
