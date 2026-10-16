import { eq } from "drizzle-orm";
import { createDb } from "../db";
import { discordInstallations, slackInstallations } from "../db/schema";
import type { AppEnv } from "../types";

// Each team's Discord server. One Discord app (one bot token, the DISCORD_BOT_TOKEN secret) is
// added to every team's server; a team's row says which server is its own. A team has Discord or
// Slack, never both (docs/roadmap/discord.md).

type Env = AppEnv["Bindings"];

export type TeamDiscord = {
  guildId: string;
  guildName: string | null;
};

/** Whether this server can take Discord at all: the app's settings are in place. */
export const discordConfigured = (env: Env) =>
  Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_BOT_TOKEN);

/** A team's Discord server, or null if it hasn't connected one. */
export async function discordForTeam(env: Env, teamId: string): Promise<TeamDiscord | null> {
  const row = await createDb(env.DB)
    .select()
    .from(discordInstallations)
    .where(eq(discordInstallations.teamId, teamId))
    .get();
  return row ? { guildId: row.guildId, guildName: row.guildName } : null;
}

/** The team a Discord server belongs to, or null if no team has connected it. */
export async function teamForGuild(env: Env, guildId: string): Promise<string | null> {
  const row = await createDb(env.DB)
    .select({ teamId: discordInstallations.teamId })
    .from(discordInstallations)
    .where(eq(discordInstallations.guildId, guildId))
    .get();
  return row?.teamId ?? null;
}

/**
 * Saves (or replaces) a team's server. "taken" when another team has that server, "slack" when
 * the team still has Slack connected (it disconnects Slack first).
 */
export async function saveDiscordInstallation(
  env: Env,
  install: {
    teamId: string;
    guildId: string;
    guildName: string | null;
    installedBy: string | null;
  },
): Promise<"saved" | "taken" | "slack"> {
  const db = createDb(env.DB);
  const owner = await teamForGuild(env, install.guildId);
  if (owner && owner !== install.teamId) return "taken";
  const slack = await db
    .select({ teamId: slackInstallations.teamId })
    .from(slackInstallations)
    .where(eq(slackInstallations.teamId, install.teamId))
    .get();
  if (slack) return "slack";
  const now = Math.floor(Date.now() / 1000);
  const values = {
    guildId: install.guildId,
    guildName: install.guildName,
    installedBy: install.installedBy,
    updatedAt: now,
  };
  await db
    .insert(discordInstallations)
    .values({ teamId: install.teamId, createdAt: now, ...values })
    .onConflictDoUpdate({ target: discordInstallations.teamId, set: values });
  return "saved";
}

/** Forgets a team's server (an admin disconnected it, or the bot is no longer in it). */
export async function removeDiscordInstallation(env: Env, teamId: string): Promise<void> {
  await createDb(env.DB)
    .delete(discordInstallations)
    .where(eq(discordInstallations.teamId, teamId));
}
