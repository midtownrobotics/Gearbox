import type { DiscordGuild, DiscordUser } from "@g3/discord";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import {
  coreSessions,
  coreSlackLinkCodes,
  coreUserIdentities,
  coreUsers,
  discordInstallations,
  teams,
} from "../db/schema";
import {
  CHAT_LABELS,
  chatForTeam,
  chatProvider,
  isChatChannelId,
  postError,
  postToChannel,
} from "../lib/chat";
import { saveDiscordInstallation } from "../lib/discord-install";
import { signInWithDiscord } from "../lib/discord-sign-in";
import { createHandoff } from "../lib/handoff";
import { dmAdmins, dmMembers } from "../lib/member-dm";
import { createSigninCode } from "../lib/slack-code";
import { saveInstallation } from "../lib/slack-install";
import { siteTeamId } from "../lib/team";
import { logToTeam } from "../lib/team-log";
import type { AppEnv } from "../types";

// For other workers only, over service bindings: the platform worker signs teams up through these,
// and its operator console (roadmap 2.8) deletes and hands over teams through them.
// Apps read a team's members and send its Slack or Discord messages through them (@g3/auth).
// The gateway never answers /api/internal, and production workers have no other public address.

type NewTeam = { id: string; teamNumber: number; name: string };

/** The team's members (?1 is the team's id). */
const MEMBERS = "(SELECT id FROM core_users WHERE team_id = ?1)";
const MEMBER_ROWS = `user_id IN ${MEMBERS}`;
/** Deleting a team, in order: each row goes before the rows it points at. */
const DELETE_TEAM = [
  "DELETE FROM team_ui_settings WHERE team_id = ?1",
  "DELETE FROM team_sign_in_methods WHERE team_id = ?1",
  `DELETE FROM core_sessions WHERE ${MEMBER_ROWS}`,
  `DELETE FROM core_user_identities WHERE ${MEMBER_ROWS}`,
  `DELETE FROM core_user_pins WHERE team_id = ?1 OR ${MEMBER_ROWS}`,
  `DELETE FROM kiosk_activation_codes WHERE team_id = ?1 OR created_by IN ${MEMBERS}`,
  `DELETE FROM kiosk_devices WHERE team_id = ?1 OR created_by IN ${MEMBERS}`,
  `DELETE FROM core_slack_link_codes WHERE team_id = ?1 OR ${MEMBER_ROWS}`,
  "DELETE FROM slack_installations WHERE team_id = ?1",
  `UPDATE slack_installations SET installed_by = NULL WHERE installed_by IN ${MEMBERS}`,
  "DELETE FROM discord_installations WHERE team_id = ?1",
  `UPDATE discord_installations SET installed_by = NULL WHERE installed_by IN ${MEMBERS}`,
  `UPDATE core_users SET merged_into_user_id = NULL WHERE merged_into_user_id IN ${MEMBERS}`,
  "DELETE FROM core_users WHERE team_id = ?1",
  "DELETE FROM teams WHERE id = ?1",
];

type NewInstallation = {
  teamId: string;
  workspaceId: string;
  workspaceName: string | null;
  botUserId: string | null;
  botToken: string;
};

/**
 * Deletes a team from G3ID: every account in it, their sign-ins and sessions, its kiosks and its
 * Slack or Discord connection. Returns the deleted accounts' ids.
 */
export async function deleteTeam(env: AppEnv["Bindings"], id: string): Promise<string[]> {
  const db = createDb(env.DB);
  const members = await db
    .select({ id: coreUsers.id })
    .from(coreUsers)
    .where(eq(coreUsers.teamId, id))
    .all();
  const sessions = members.length
    ? await db
        .select({ id: coreSessions.id })
        .from(coreSessions)
        .where(
          inArray(
            coreSessions.userId,
            members.map((m) => m.id),
          ),
        )
        .all()
    : [];
  await env.DB.batch(DELETE_TEAM.map((sql) => env.DB.prepare(sql).bind(id)));
  // Sessions are looked up in KV; without their user they'd fail anyway, but don't leave them.
  await Promise.all(
    sessions.flatMap(({ id: session }) => [
      env.SESSIONS.delete(`session:${session}`),
      env.SESSIONS.delete(`session:${session}:meta`),
    ]),
  );
  return members.map((m) => m.id);
}

export const internalRouter = new Hono<AppEnv>()
  // A team the platform signed up. The platform keeps the team's record; G3ID keeps its id, number
  // and name, which its own tables (users, kiosks, Slack) point at.
  .put("/teams", async (c) => {
    const team = await c.req.json<NewTeam>();
    const now = Math.floor(Date.now() / 1000);
    await createDb(c.env.DB)
      .insert(teams)
      .values({ ...team, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: teams.id, set: { name: team.name, updatedAt: now } });
    return c.json({ ok: true });
  })
  // A team's members, for the operator console (and handing a team to one of them).
  .get("/teams/:id/members", async (c) => {
    const members = await createDb(c.env.DB)
      .select({
        id: coreUsers.id,
        displayName: coreUsers.displayName,
        email: coreUsers.email,
        status: coreUsers.status,
        isAdmin: coreUsers.isAdmin,
        isMentor: coreUsers.isMentor,
        lastLoginAt: coreUsers.lastLoginAt,
      })
      .from(coreUsers)
      .where(
        and(
          eq(coreUsers.teamId, c.req.param("id")),
          ne(coreUsers.status, "merged"),
          isNull(coreUsers.deletedAt),
        ),
      )
      .orderBy(coreUsers.displayName)
      .all();
    // Who the team's bot can DM: members with its chat (Slack or Discord) linked.
    const provider = (await chatProvider(c.env, c.req.param("id"))) ?? "slack";
    const withChat = new Set(
      (
        await createDb(c.env.DB)
          .select({ userId: coreUserIdentities.userId })
          .from(coreUserIdentities)
          .innerJoin(coreUsers, eq(coreUsers.id, coreUserIdentities.userId))
          .where(
            and(eq(coreUsers.teamId, c.req.param("id")), eq(coreUserIdentities.provider, provider)),
          )
          .all()
      ).map((r) => r.userId),
    );
    return c.json(
      members.map((m) => ({
        ...m,
        isAdmin: m.isAdmin === 1,
        isMentor: m.isMentor === 1,
        hasChat: withChat.has(m.id),
      })),
    );
  })
  // Accounts by id, with their team: the platform's operators (who may be on any team).
  .get("/users", async (c) => {
    const ids = (c.req.query("ids") ?? "").split(",").filter(Boolean).slice(0, 100);
    if (ids.length === 0) return c.json([]);
    const users = await createDb(c.env.DB)
      .select({
        id: coreUsers.id,
        displayName: coreUsers.displayName,
        email: coreUsers.email,
        teamId: coreUsers.teamId,
      })
      .from(coreUsers)
      .where(inArray(coreUsers.id, ids))
      .all();
    return c.json(users);
  })
  // An operator deletes a team, with every account in it, their sign-ins and sessions, its kiosks
  // and its Slack connection. The site's team (site.ts) can't be: its apps' data isn't per team.
  .delete("/teams/:id", async (c) => {
    const id = c.req.param("id");
    if (id === siteTeamId) return c.json({ error: "The site's own team can't be deleted." }, 409);
    return c.json({ deletedUserIds: await deleteTeam(c.env, id) });
  })
  // An operator hands a team to one of its members: they become an active admin. The previous
  // owner stays an admin unless `demoteUserId` names them.
  .post("/teams/:id/owner", async (c) => {
    const teamId = c.req.param("id");
    const { userId, demoteUserId } = await c.req.json<{
      userId: string;
      demoteUserId?: string | null;
    }>();
    const db = createDb(c.env.DB);
    const user = await db
      .select({ id: coreUsers.id })
      .from(coreUsers)
      .where(
        and(
          eq(coreUsers.id, userId),
          eq(coreUsers.teamId, teamId),
          ne(coreUsers.status, "merged"),
          isNull(coreUsers.deletedAt),
        ),
      )
      .get();
    if (!user) return c.json({ error: "That account isn't on this team." }, 404);
    const now = Math.floor(Date.now() / 1000);
    await db
      .update(coreUsers)
      .set({ isAdmin: 1, status: "active", updatedAt: now })
      .where(eq(coreUsers.id, userId));
    if (demoteUserId && demoteUserId !== userId) {
      await db
        .update(coreUsers)
        .set({ isAdmin: 0, updatedAt: now })
        .where(and(eq(coreUsers.id, demoteUserId), eq(coreUsers.teamId, teamId)));
    }
    return c.json({ ok: true });
  })
  // The same message to every active admin of the team, each in a DM from its own bot on its chat
  // (Slack or Discord; the platform tells them when an app is switched on or off). Admins without
  // the chat linked aren't sent one; 404 when the team has no chat. `text` is in Gearbox's chat
  // format (lib/chat.ts).
  .post("/teams/:id/chat/dm-admins", async (c) => {
    const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as { text?: unknown });
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 4000)
      return c.json({ error: "text is required (up to 4000)." }, 400);
    const result = await dmAdmins(c.env, c.req.param("id"), text);
    if (!result) return c.json({ error: "This team hasn't connected Slack or Discord." }, 404);
    return c.json({ ok: true, sent: result.sent, admins: result.members });
  })
  // A message from the team's own bot to some of its members, by G3ID id (Orders' approvals,
  // Schedule's reminders, the platform's notifications). Only the team's active members with its
  // chat linked are sent one; anyone else in `userIds` is skipped. 404 when the team has no chat.
  .post("/teams/:id/chat/dm-members", async (c) => {
    const body = await c.req
      .json<{ userIds?: unknown; text?: unknown }>()
      .catch(() => ({}) as { userIds?: unknown; text?: unknown });
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 4000)
      return c.json({ error: "text is required (up to 4000)." }, 400);
    const userIds = Array.isArray(body.userIds)
      ? [...new Set(body.userIds.filter((id): id is string => typeof id === "string"))]
      : [];
    if (userIds.length === 0 || userIds.length > 100) {
      return c.json({ error: "userIds is required (up to 100)." }, 400);
    }
    const result = await dmMembers(c.env, c.req.param("id"), text, inArray(coreUsers.id, userIds));
    if (!result) return c.json({ error: "This team hasn't connected Slack or Discord." }, 404);
    return c.json({ ok: true, sent: result.sent, members: result.members });
  })
  // Which apps the team has on (the platform's app library), for an app whose feature needs
  // another (`teamHasApp` in @g3/auth). 503 when the platform can't say.
  .get("/teams/:id/apps", async (c) => {
    if (!c.env.PLATFORM) return c.json({ error: "No platform here." }, 503);
    const res = await c.env.PLATFORM.fetch(
      new Request(`http://platform/api/teams/${encodeURIComponent(c.req.param("id"))}`),
    ).catch(() => null);
    if (!res?.ok) return c.json({ error: "The platform didn't answer." }, 503);
    const team = (await res.json()) as { apps?: string[] };
    return c.json({ apps: team.apps ?? [] });
  })
  // A change for the team's log, from another app (`logTeamChange` in @g3/auth): passed on to the
  // platform, which keeps the log.
  .post("/teams/:id/audit", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.app !== "string" || typeof body.what !== "string") {
      return c.json({ error: "Say which app and what changed." }, 400);
    }
    const ok = await logToTeam(c.env, c.req.param("id"), {
      userId: typeof body.userId === "string" ? body.userId : null,
      app: body.app,
      what: body.what,
      changed: Array.isArray(body.changed) ? body.changed.map(String) : [],
    });
    return ok
      ? c.json({ ok: true })
      : c.json({ error: "The team's log couldn't be written." }, 502);
  })
  // A post from the team's own bot in one of its channels (Shop's release and daily summary
  // posts, the platform's notifications), on Slack or Discord, whichever the team has. 404 when
  // the team has no chat; the service's own refusal (not_in_channel, ...) is passed back as the
  // error.
  .post("/teams/:id/chat/message", async (c) => {
    const body = await c.req
      .json<{ channel?: unknown; text?: unknown }>()
      .catch(() => ({}) as { channel?: unknown; text?: unknown });
    const { channel, text } = body;
    const teamId = c.req.param("id");
    const chat = await chatForTeam(c.env, teamId);
    if (!chat) return c.json({ error: "This team hasn't connected Slack or Discord." }, 404);
    if (typeof channel !== "string" || !isChatChannelId(chat.provider, channel)) {
      return c.json({ error: `channel must be a ${CHAT_LABELS[chat.provider]} channel ID.` }, 400);
    }
    if (typeof text !== "string" || !text.trim()) {
      return c.json({ error: "text is required." }, 400);
    }
    if (text.length > 40_000) return c.json({ error: "text is too long." }, 400);
    try {
      await postToChannel(c.env, teamId, chat, channel, text);
    } catch (err) {
      return c.json({ error: postError(err) }, 502);
    }
    return c.json({ ok: true });
  })
  // The team's Slack workspace, from the sign-up's "Add to Slack".
  .post("/slack-installations", async (c) => {
    const install = await c.req.json<NewInstallation>();
    const result = await saveInstallation(c.env, { ...install, installedBy: null });
    return c.json({ result }, result === "saved" ? 200 : 409);
  })
  // The team's Discord server and its founder, from the sign-up's "Add to Discord" (one authorize
  // adds the bot and signs the founder in). The team has no members yet, so the founder becomes
  // its first admin; the answer's token is spent at /auth/handoff on the team's own address,
  // which sets the session cookie there.
  .post("/teams/:id/discord-founder", async (c) => {
    const teamId = c.req.param("id");
    const body = await c.req.json<{ guild: DiscordGuild; user: DiscordUser }>();
    const saved = await saveDiscordInstallation(c.env, {
      teamId,
      guildId: body.guild.id,
      guildName: body.guild.name,
      installedBy: null,
    });
    if (saved === "taken") {
      return c.json({ error: "That Discord server is already connected to another team." }, 409);
    }
    if (saved === "slack") return c.json({ error: "This team already has Slack." }, 409);
    const signIn = await signInWithDiscord(c.env, teamId, body.user);
    if (signIn.result === "failed") return c.json({ error: signIn.message }, 409);
    if (signIn.result !== "signed_in" || !signIn.firstAdmin) {
      return c.json({ error: "This team already has members." }, 409);
    }
    await createDb(c.env.DB)
      .update(discordInstallations)
      .set({ installedBy: signIn.userId })
      .where(eq(discordInstallations.teamId, teamId));
    return c.json({
      userId: signIn.userId,
      token: await createHandoff(c.env, teamId, signIn.sessionId),
    });
  })
  // The code the founder sends to the bot: the team has no members yet, so whoever sends it from
  // the team's workspace becomes its first admin (lib/slack-code.ts).
  .post("/signup-codes", async (c) => {
    const { teamId, redirect } = await c.req.json<{ teamId: string; redirect: string | null }>();
    return c.json(await createSigninCode(createDb(c.env.DB), teamId, redirect));
  })
  .get("/signup-codes/:token", async (c) => {
    const code = await createDb(c.env.DB)
      .select({
        status: coreSlackLinkCodes.status,
        message: coreSlackLinkCodes.statusMessage,
        userId: coreSlackLinkCodes.userId,
        expiresAt: coreSlackLinkCodes.expiresAt,
      })
      .from(coreSlackLinkCodes)
      .where(eq(coreSlackLinkCodes.pollingToken, c.req.param("token")))
      .get();
    if (!code) return c.json({ status: "expired" });
    if (code.status === "pending" && code.expiresAt < Math.floor(Date.now() / 1000)) {
      return c.json({ status: "expired" });
    }
    return c.json(code);
  });
