-- Subteams (programming, mechanical, outreach…): a team's admins switch them on and name them on
-- the Subteams page of the team's admin pages. Each member is in one or none, chosen when they
-- join or later on their Account page; admins change it on the member's page. A team without a
-- settings row has them off.
CREATE TABLE team_subteam_settings (
  team_id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES core_users(id) ON DELETE SET NULL
);

CREATE TABLE subteams (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX subteams_team_name_uniq ON subteams(team_id, name COLLATE NOCASE);

ALTER TABLE core_users ADD COLUMN subteam_id TEXT REFERENCES subteams(id) ON DELETE SET NULL;
