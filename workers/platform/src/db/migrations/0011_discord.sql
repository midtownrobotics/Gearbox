-- A team signed up with Discord instead of Slack (docs/roadmap/discord.md): the server its
-- founder added the bot to, for the operators' console. G3ID keeps the connection itself.
ALTER TABLE teams ADD COLUMN discord_guild_id TEXT;
ALTER TABLE teams ADD COLUMN discord_guild_name TEXT;
