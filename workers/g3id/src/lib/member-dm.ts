import { type SQL, and, eq } from "drizzle-orm";
import { createDb } from "../db";
import { coreUserIdentities, coreUsers } from "../db/schema";
import type { AppEnv } from "../types";
import { chatForTeam, sendChatDM } from "./chat";

/**
 * DMs the team's active members matching `which` that have the team's chat (Slack or Discord)
 * linked, from the team's own bot. `text` is in Gearbox's chat format (lib/chat.ts). Null when
 * the team has no chat. Never throws for one DM that fails.
 */
export async function dmMembers(env: AppEnv["Bindings"], teamId: string, text: string, which: SQL) {
  const chat = await chatForTeam(env, teamId);
  if (!chat) return null;
  const rows = await createDb(env.DB)
    .select({ chatId: coreUserIdentities.providerId })
    .from(coreUsers)
    .innerJoin(coreUserIdentities, eq(coreUserIdentities.userId, coreUsers.id))
    .where(
      and(
        eq(coreUsers.teamId, teamId),
        eq(coreUsers.status, "active"),
        eq(coreUserIdentities.provider, chat.provider),
        which,
      ),
    )
    .all();
  const ids = [...new Set(rows.map((r) => r.chatId).filter((id): id is string => !!id))];
  let sent = 0;
  for (const id of ids) {
    try {
      await sendChatDM(env, teamId, chat, id, text);
      sent++;
    } catch (err) {
      console.error(`[${chat.provider}] member DM failed`, id, err);
    }
  }
  return { sent, members: ids.length };
}

/** DMs every active admin of the team with its chat linked (see dmMembers). */
export const dmAdmins = (env: AppEnv["Bindings"], teamId: string, text: string) =>
  dmMembers(env, teamId, text, eq(coreUsers.isAdmin, 1));

/** DMs one member by their G3ID id, if they have the team's chat linked. False when not sent. */
export const dmMember = async (
  env: AppEnv["Bindings"],
  teamId: string,
  userId: string,
  text: string,
) => ((await dmMembers(env, teamId, text, eq(coreUsers.id, userId)))?.sent ?? 0) > 0;
