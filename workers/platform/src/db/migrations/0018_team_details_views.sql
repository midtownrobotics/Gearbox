-- The operator access log tells a team apart opening its details (no member's name or email:
-- `view_team_details`) from opening its member list (`view_team`, as before). The allowed actions
-- are a CHECK in the table's definition, so the table is rebuilt; nothing points at it.
CREATE TABLE operator_actions_new (
  id TEXT PRIMARY KEY NOT NULL,
  operator_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('view_team', 'view_team_details', 'delete_team',
    'renumber_team', 'transfer_owner', 'suspend_team', 'reactivate_team', 'resolve_report',
    'reopen_report', 'add_operator', 'remove_operator', 'create_notification',
    'delete_notification', 'block_reporter', 'unblock_reporter')),
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
