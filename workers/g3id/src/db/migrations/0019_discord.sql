-- Discord beside Slack (docs/roadmap/discord.md). A team connects Slack or Discord, one at a
-- time. One Discord app serves every team with one bot token (a Worker secret), so a team's
-- connection is only its server's id: nothing secret is stored here.
CREATE TABLE discord_installations (
  team_id TEXT PRIMARY KEY NOT NULL REFERENCES teams(id),
  -- The server (guild) the bot was added to.
  guild_id TEXT NOT NULL UNIQUE,
  guild_name TEXT,
  installed_by TEXT REFERENCES core_users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 'discord' becomes a sign-in provider. SQLite can't change a CHECK, so the table is rebuilt
-- (nothing references it). 'onshape' goes from the CHECK too: migration 0017 deleted its rows.
CREATE TABLE core_user_identities_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES core_users(id),
  provider TEXT NOT NULL CHECK (provider IN ('local', 'google', 'slack', 'discord', 'github', 'steam')),
  provider_id TEXT,
  provider_email TEXT,
  password_hash TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,
  token_scopes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider, provider_id)
);

INSERT INTO core_user_identities_new (
  id, user_id, provider, provider_id, provider_email, password_hash, access_token,
  refresh_token, token_expires_at, token_scopes, created_at, updated_at
)
SELECT
  id, user_id, provider, provider_id, provider_email, password_hash, access_token,
  refresh_token, token_expires_at, token_scopes, created_at, updated_at
FROM core_user_identities
WHERE provider <> 'onshape';

DROP TABLE core_user_identities;
ALTER TABLE core_user_identities_new RENAME TO core_user_identities;
CREATE INDEX core_user_identities_user_id_idx ON core_user_identities(user_id);
