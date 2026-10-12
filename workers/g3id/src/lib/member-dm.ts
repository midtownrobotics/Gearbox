import { sendDM } from "@g3/slack";
import { type SQL, and, eq } from "drizzle-orm";
import { createDb } from "../db";
import { coreUserIdentities, coreUsers } from "../db/schema";
import type { AppEnv } from "../types";
import { slackForTeam } from "./slack-install";

/**
 * DMs the team's active members matching `which` that have a linked Slack account, from the
 * team's own bot. Null when the team has no Slack. Never throws for one DM that fails.
 */
export async function dmMembers(env: AppEnv["Bindings"], teamId: string, text: string, which: SQL) {
  const teamSlack = await slackForTeam(env, teamId);
  if (!teamSlack) return null;
  const rows = await createDb(env.DB)
    .select({ slackId: coreUserIdentities.providerId })
    .from(coreUsers)
    .innerJoin(coreUserIdentities, eq(coreUserIdentities.userId, coreUsers.id))
    .where(
      and(
        eq(coreUsers.teamId, teamId),
        eq(coreUsers.status, "active"),
        eq(coreUserIdentities.provider, "slack"),
        which,
      ),
    )
    .all();
  const ids = [...new Set(rows.map((r) => r.slackId).filter((id): id is string => !!id))];
  let sent = 0;
  for (const id of ids) {
    try {
      await sendDM(id, text, teamSlack.slack);
      sent++;
    } catch (err) {
      console.error("[slack] member DM failed", id, err);
    }
  }
  return { sent, members: ids.length };
}

/** DMs every active admin of the team with a linked Slack account (see dmMembers). */
export const dmAdmins = (env: AppEnv["Bindings"], teamId: string, text: string) =>
  dmMembers(env, teamId, text, eq(coreUsers.isAdmin, 1));
