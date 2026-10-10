import { sendDM, sendMessage } from "@g3/slack";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import {
  coreSessions,
  coreSlackLinkCodes,
  coreUserIdentities,
  coreUsers,
  teams,
} from "../db/schema";
import { createSigninCode } from "../lib/slack-code";
import { saveInstallation, slackForTeam } from "../lib/slack-install";
import { siteTeamId } from "../lib/team";
import { logToTeam } from "../lib/team-log";
import type { AppEnv } from "../types";

// For other workers only, over service bindings: the platform worker signs teams up through these,
// and its operator console (roadmap 2.8) deletes and hands over teams through them.
// Apps read a team's members and send its Slack messages through them (@g3/auth).
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
    return c.json(
      members.map((m) => ({ ...m, isAdmin: m.isAdmin === 1, isMentor: m.isMentor === 1 })),
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
    const db = createDb(c.env.DB);
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
    await c.env.DB.batch(DELETE_TEAM.map((sql) => c.env.DB.prepare(sql).bind(id)));
    // Sessions are looked up in KV; without their user they'd fail anyway, but don't leave them.
    await Promise.all(
      sessions.flatMap(({ id: session }) => [
        c.env.SESSIONS.delete(`session:${session}`),
        c.env.SESSIONS.delete(`session:${session}:meta`),
      ]),
    );
    return c.json({ deletedUserIds: members.map((m) => m.id) });
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
  // A direct message from the team's own Slack bot (an app telling a member something, like Orders
  // approving their request). The bot token never leaves G3ID. 404 when the team has no Slack.
  .post("/teams/:id/slack/dm", async (c) => {
    const body = await c.req
      .json<{ slackUserId?: unknown; text?: unknown }>()
      .catch(() => ({}) as { slackUserId?: unknown; text?: unknown });
    const { slackUserId, text } = body;
    if (typeof slackUserId !== "string" || typeof text !== "string" || !text.trim()) {
      return c.json({ error: "slackUserId and text are required." }, 400);
    }
    // Only ever a member's DM, never a channel.
    if (!/^[UW][A-Z0-9]+$/.test(slackUserId)) {
      return c.json({ error: "slackUserId must be a Slack user ID." }, 400);
    }
    if (text.length > 4000) return c.json({ error: "text is too long." }, 400);
    const teamSlack = await slackForTeam(c.env, c.req.param("id"));
    if (!teamSlack) return c.json({ error: "This team hasn't connected Slack." }, 404);
    try {
      await sendDM(slackUserId, text, teamSlack.slack);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
    return c.json({ ok: true });
  })
  // The same message to every active admin of the team, each in a DM from its own bot (the
  // platform tells them when an app is switched on or off). Admins without a linked Slack account
  // aren't sent one; 404 when the team has no Slack.
  .post("/teams/:id/slack/dm-admins", async (c) => {
    const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as { text?: unknown });
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 4000)
      return c.json({ error: "text is required (up to 4000)." }, 400);
    const teamId = c.req.param("id");
    const teamSlack = await slackForTeam(c.env, teamId);
    if (!teamSlack) return c.json({ error: "This team hasn't connected Slack." }, 404);
    const admins = await createDb(c.env.DB)
      .select({ slackId: coreUserIdentities.providerId })
      .from(coreUsers)
      .innerJoin(coreUserIdentities, eq(coreUserIdentities.userId, coreUsers.id))
      .where(
        and(
          eq(coreUsers.teamId, teamId),
          eq(coreUsers.isAdmin, 1),
          eq(coreUsers.status, "active"),
          eq(coreUserIdentities.provider, "slack"),
        ),
      )
      .all();
    const ids = [...new Set(admins.map((a) => a.slackId).filter((id): id is string => !!id))];
    let sent = 0;
    for (const id of ids) {
      try {
        await sendDM(id, text, teamSlack.slack);
        sent++;
      } catch (err) {
        console.error("[slack] admin DM failed", id, err);
      }
    }
    return c.json({ ok: true, sent, admins: ids.length });
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
  // A message from the team's own Slack bot to one of its channels (Shop's release and daily
  // summary posts). 404 when the team has no Slack; Slack's own refusal (not_in_channel, ...) is
  // passed back as the error.
  .post("/teams/:id/slack/message", async (c) => {
    const body = await c.req
      .json<{ channel?: unknown; text?: unknown }>()
      .catch(() => ({}) as { channel?: unknown; text?: unknown });
    const { channel, text } = body;
    if (typeof channel !== "string" || !/^[CG][A-Z0-9]+$/.test(channel)) {
      return c.json({ error: "channel must be a Slack channel ID." }, 400);
    }
    if (typeof text !== "string" || !text.trim()) {
      return c.json({ error: "text is required." }, 400);
    }
    if (text.length > 40_000) return c.json({ error: "text is too long." }, 400);
    const teamSlack = await slackForTeam(c.env, c.req.param("id"));
    if (!teamSlack) return c.json({ error: "This team hasn't connected Slack." }, 404);
    try {
      await sendMessage(channel, text, teamSlack.slack);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
    return c.json({ ok: true });
  })
  // The team's Slack workspace, from the sign-up's "Add to Slack".
  .post("/slack-installations", async (c) => {
    const install = await c.req.json<NewInstallation>();
    const result = await saveInstallation(c.env, { ...install, installedBy: null });
    return c.json({ result }, result === "saved" ? 200 : 409);
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
