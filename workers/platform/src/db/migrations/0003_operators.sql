-- Platform operators and their console (roadmap step 2.8). Operators are G3ID accounts flagged
-- here, by the platform, not by any team role: a team admin is never an operator because of it.
-- The first operator is added by hand (docs/deploy.md); after that, operators add each other in
-- the console.
CREATE TABLE operators (
  -- G3ID's user id. The account belongs to a team like any other; the flag is platform-wide.
  user_id TEXT PRIMARY KEY NOT NULL,
  added_by TEXT,
  created_at INTEGER NOT NULL
);

-- Everything an operator does in the console, and each time one opens a team's details (its
-- members' names and emails): the operator access log in the privacy policy, kept 12 months.
-- Rows aren't edited, except that a team's rows follow it when it's renumbered. A deleted team's
-- rows stay, with its number and name in `details`.
CREATE TABLE operator_actions (
  id TEXT PRIMARY KEY NOT NULL,
  operator_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('view_team', 'delete_team', 'renumber_team',
    'transfer_owner', 'suspend_team', 'reactivate_team', 'resolve_report', 'reopen_report',
    'add_operator', 'remove_operator')),
  -- The team acted on (its id at the time), if any.
  team_id TEXT,
  -- Why, in the operator's words. Required for actions on a team.
  reason TEXT,
  -- JSON: what changed (old and new numbers, previous and new owner, the report's id, ...).
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX operator_actions_team_id_idx ON operator_actions(team_id);
CREATE INDEX operator_actions_created_at_idx ON operator_actions(created_at);

-- Who owns a team: its founder until an operator hands it to another member.
ALTER TABLE teams ADD COLUMN owner_user_id TEXT;
UPDATE teams SET owner_user_id = founder_user_id;

-- Reports: when an operator closed one, and who.
ALTER TABLE number_reports ADD COLUMN resolved_at INTEGER;
ALTER TABLE number_reports ADD COLUMN resolved_by TEXT;
