-- Reporter IDs (src/reports.ts): each member who sends a problem report gets a random ID that
-- stands for them on the public GitHub issue. It isn't their account id, so an operator can block
-- a reporter from the console by it without learning who they are. Deleted with the team.
CREATE TABLE reporters (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  -- Blocked by an operator: their reports are refused, and unsent ones never reach GitHub.
  blocked_at INTEGER,
  blocked_by TEXT,
  block_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX reporters_user ON reporters (team_id, user_id);

-- Everyone who has sent a report already gets one.
INSERT INTO reporters (id, team_id, user_id, created_at)
SELECT lower(hex(randomblob(5))), team_id, user_id, min(created_at)
FROM problem_reports GROUP BY team_id, user_id;

ALTER TABLE problem_reports ADD COLUMN reporter_id TEXT;
UPDATE problem_reports SET reporter_id = (
  SELECT r.id FROM reporters r
  WHERE r.team_id = problem_reports.team_id AND r.user_id = problem_reports.user_id
);

-- Two more kinds of line in the operator access log: a reporter blocked or unblocked. The
-- allowed actions are a CHECK in the table's definition, so the table is rebuilt; nothing points
-- at it.
CREATE TABLE operator_actions_new (
  id TEXT PRIMARY KEY NOT NULL,
  operator_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('view_team', 'delete_team', 'renumber_team',
    'transfer_owner', 'suspend_team', 'reactivate_team', 'resolve_report', 'reopen_report',
    'add_operator', 'remove_operator', 'create_notification', 'delete_notification',
    'block_reporter', 'unblock_reporter')),
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
