-- Slack per team (roadmap step 2.6). One Slack app, installed into each team's workspace from
-- G3ID's admin pages; slash commands and events find the team by the workspace they come from.
-- The bot token is encrypted (lib/secret-box.ts) with the SECRETS_KEY Worker secret. A team
-- without a row uses the SLACK_BOT_TOKEN / SLACK_TEAM_ID settings if it's the site's team (G3's
-- install from before teams), and has no Slack otherwise.
CREATE TABLE slack_installations (
  team_id TEXT PRIMARY KEY NOT NULL REFERENCES teams(id),
  -- The workspace's ID (T...), which slash commands and events arrive with.
  slack_team_id TEXT NOT NULL UNIQUE,
  slack_team_name TEXT,
  bot_user_id TEXT,
  bot_token_encrypted TEXT NOT NULL,
  installed_by TEXT REFERENCES core_users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
