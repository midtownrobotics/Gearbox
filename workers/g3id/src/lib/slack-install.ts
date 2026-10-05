import { eq } from "drizzle-orm";
import { createDb } from "../db";
import { slackInstallations } from "../db/schema";
import type { AppEnv } from "../types";
import { decryptSecret, encryptSecret } from "./secret-box";
import { siteTeamId } from "./team";

// Each team's Slack workspace. One Slack app is installed into every team's workspace (from
// G3ID's admin pages); slash commands and events find their team by the workspace they come from.
// The site's team can also use the SLACK_BOT_TOKEN / SLACK_TEAM_ID settings, G3's install from
// before teams, until it connects through the admin page.

type Env = AppEnv["Bindings"];

export type TeamSlack = {
  /** The workspace's ID (T...). */
  workspaceId: string;
  workspaceName: string | null;
  /** From the SLACK_BOT_TOKEN / SLACK_TEAM_ID settings rather than an install (can't disconnect). */
  fromSettings: boolean;
  /** For @g3/slack's sendDM, getUserInfo, ... */
  slack: { SLACK_BOT_TOKEN: string };
};

/** A team's Slack, or null if it hasn't connected one. */
export async function slackForTeam(env: Env, teamId: string): Promise<TeamSlack | null> {
  const row = await createDb(env.DB)
    .select()
    .from(slackInstallations)
    .where(eq(slackInstallations.teamId, teamId))
    .get();
  if (row) {
    return {
      workspaceId: row.slackTeamId,
      workspaceName: row.slackTeamName,
      fromSettings: false,
      slack: { SLACK_BOT_TOKEN: await decryptSecret(row.botTokenEncrypted, env.SECRETS_KEY) },
    };
  }
  if (teamId === siteTeamId && env.SLACK_BOT_TOKEN && env.SLACK_TEAM_ID) {
    return {
      workspaceId: env.SLACK_TEAM_ID,
      workspaceName: null,
      fromSettings: true,
      slack: { SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN },
    };
  }
  return null;
}

/** The team a Slack workspace belongs to, or null if no team has connected it. */
export async function teamForWorkspace(env: Env, workspaceId: string): Promise<string | null> {
  if (!workspaceId) return null;
  const row = await createDb(env.DB)
    .select({ teamId: slackInstallations.teamId })
    .from(slackInstallations)
    .where(eq(slackInstallations.slackTeamId, workspaceId))
    .get();
  if (row) return row.teamId;
  if (workspaceId === env.SLACK_TEAM_ID) {
    // G3's install from before teams, unless the site's team has since connected another.
    const site = await slackForTeam(env, siteTeamId);
    if (site?.workspaceId === workspaceId) return siteTeamId;
  }
  return null;
}

/** Saves (or replaces) a team's workspace. Fails if another team already has that workspace. */
export async function saveInstallation(
  env: Env,
  install: {
    teamId: string;
    workspaceId: string;
    workspaceName: string | null;
    botUserId: string | null;
    botToken: string;
    /** The admin who connected it; null when it came with the team's sign-up. */
    installedBy: string | null;
  },
): Promise<"saved" | "taken"> {
  const owner = await teamForWorkspace(env, install.workspaceId);
  if (owner && owner !== install.teamId) return "taken";
  const now = Math.floor(Date.now() / 1000);
  const values = {
    slackTeamId: install.workspaceId,
    slackTeamName: install.workspaceName,
    botUserId: install.botUserId,
    botTokenEncrypted: await encryptSecret(install.botToken, env.SECRETS_KEY),
    installedBy: install.installedBy,
    updatedAt: now,
  };
  await createDb(env.DB)
    .insert(slackInstallations)
    .values({ teamId: install.teamId, createdAt: now, ...values })
    .onConflictDoUpdate({ target: slackInstallations.teamId, set: values });
  return "saved";
}

/** Forgets a team's workspace (the admin disconnected it, or Slack says the app was removed). */
export async function removeInstallation(
  env: Env,
  by: { teamId: string } | { workspaceId: string },
): Promise<void> {
  await createDb(env.DB)
    .delete(slackInstallations)
    .where(
      "teamId" in by
        ? eq(slackInstallations.teamId, by.teamId)
        : eq(slackInstallations.slackTeamId, by.workspaceId),
    );
}
