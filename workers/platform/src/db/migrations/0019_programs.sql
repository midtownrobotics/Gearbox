-- FTC teams (FRC and FTC number their teams separately). A team's id is its program and number:
-- 'frc1648', 'ftc12345'. Teams are unique by program and number, so FRC 254 and FTC 254 can both
-- sign up. `program_chosen_at` is when the team said which program it's in: every team from before
-- this is FRC until one of its admins answers (an FTC team is then moved to its 'ftc' id, see
-- team_moves); the site team and the demo are FRC and need not answer.
--
-- The id's CHECK and the number's UNIQUE are in the table's definition, so `teams` is rebuilt.
-- Dropping it deletes the rows of every table that points at it with ON DELETE CASCADE, so those
-- are kept aside first and put back once `teams` is full again; the checks of the others wait
-- until the end (D1 ignores `PRAGMA foreign_keys = OFF` in a migration).
PRAGMA defer_foreign_keys = true;

CREATE TABLE keep_team_apps AS SELECT * FROM team_apps;
CREATE TABLE keep_team_audit_log AS SELECT * FROM team_audit_log;
CREATE TABLE keep_notifications AS SELECT * FROM notifications;
CREATE TABLE keep_team_notification_settings AS SELECT * FROM team_notification_settings;
CREATE TABLE keep_teams AS SELECT * FROM teams;

DROP TABLE teams;

CREATE TABLE teams (
  -- The team's key, as FIRST's sites write it: its program and number ('frc1648', 'ftc12345').
  id TEXT PRIMARY KEY NOT NULL CHECK (id = program || team_number),
  program TEXT NOT NULL DEFAULT 'frc' CHECK (program IN ('frc', 'ftc')),
  team_number INTEGER NOT NULL CHECK (team_number > 0),
  -- When the team said which program it's in (at sign-up, or an admin since). Null: not yet.
  program_chosen_at INTEGER,
  name TEXT NOT NULL,
  country TEXT NOT NULL CHECK (length(country) = 2),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'suspended')),
  founder_user_id TEXT,
  owner_user_id TEXT,
  slack_workspace_id TEXT,
  slack_workspace_name TEXT,
  discord_guild_id TEXT,
  discord_guild_name TEXT,
  terms_accepted_at INTEGER,
  terms_version TEXT,
  signup_id TEXT UNIQUE,
  signup_code_token TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (program, team_number)
);

INSERT INTO teams (id, program, team_number, program_chosen_at, name, country, status,
                   founder_user_id, owner_user_id, slack_workspace_id, slack_workspace_name,
                   discord_guild_id, discord_guild_name, terms_accepted_at, terms_version,
                   signup_id, signup_code_token, created_at, updated_at)
SELECT id, 'frc', team_number,
       -- G3 (the site team) and the public demo are FRC teams.
       CASE WHEN id IN ('frc1648', 'frc9999') THEN unixepoch() END,
       name, country, status, founder_user_id, owner_user_id, slack_workspace_id,
       slack_workspace_name, discord_guild_id, discord_guild_name, terms_accepted_at,
       terms_version, signup_id, signup_code_token, created_at, updated_at
FROM keep_teams;
DROP TABLE keep_teams;

DELETE FROM team_apps;
INSERT INTO team_apps SELECT * FROM keep_team_apps;
DROP TABLE keep_team_apps;
DELETE FROM team_audit_log;
INSERT INTO team_audit_log SELECT * FROM keep_team_audit_log;
DROP TABLE keep_team_audit_log;
DELETE FROM notifications;
INSERT INTO notifications SELECT * FROM keep_notifications;
DROP TABLE keep_notifications;
DELETE FROM team_notification_settings;
INSERT INTO team_notification_settings SELECT * FROM keep_team_notification_settings;
DROP TABLE keep_team_notification_settings;

-- Reports about a number name its program too.
ALTER TABLE number_reports ADD COLUMN program TEXT NOT NULL DEFAULT 'frc'
  CHECK (program IN ('frc', 'ftc'));

-- A team moved to another id: an FRC-numbered team that said it's in FTC ('frc12345' →
-- 'ftc12345'), or an operator changing a team's program. While `finished_at` is null its data is
-- being moved in every app (each app's move hook, then G3ID's, then the platform's own rows) and
-- the team's addresses say so; a move that stops partway is tried again by the hourly cron. Once
-- it's done the old id's addresses send pages to the new ones and pass API calls on to the team,
-- until another team signs up with the old id.
CREATE TABLE team_moves (
  from_id TEXT PRIMARY KEY NOT NULL,
  to_id TEXT NOT NULL,
  -- Who chose it (a G3ID account), or null for an operator (in operator_actions).
  requested_by TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  -- How many times it's been tried, and what went wrong last.
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX team_moves_to_id_idx ON team_moves (to_id);

-- Operators can change a team's program (logged as `change_program`). The allowed actions are a
-- CHECK in the table's definition, so the table is rebuilt; nothing points at it.
CREATE TABLE operator_actions_new (
  id TEXT PRIMARY KEY NOT NULL,
  operator_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('view_team', 'view_team_details', 'delete_team',
    'renumber_team', 'transfer_owner', 'suspend_team', 'reactivate_team', 'resolve_report',
    'reopen_report', 'add_operator', 'remove_operator', 'create_notification',
    'delete_notification', 'block_reporter', 'unblock_reporter', 'change_program')),
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
