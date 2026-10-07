import { sendDM, sendMessage } from "@g3/slack";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { coreSessions, coreSlackLinkCodes, coreUsers, teams } from "../db/schema";
import { createSigninCode } from "../lib/slack-code";
import { saveInstallation, slackForTeam } from "../lib/slack-install";
import { siteTeamId } from "../lib/team";
import type { AppEnv } from "../types";

// For other workers only, over service bindings: the platform worker signs teams up through these,
// and its operator console (roadmap 2.8) deletes, renumbers and hands over teams through them.
// Apps read a team's members and send its Slack messages through them (@g3/auth).
// The gateway never answers /api/internal, and production workers have no other public address.

type NewTeam = { id: string; teamNumber: number; name: string };

/** Tables that carry a team (migrations 0012, 0013, 0014). */
const TEAM_TABLES = [
  "team_ui_settings",
  "core_users",
  "core_user_pins",
  "kiosk_devices",
  "kiosk_activation_codes",
  "core_slack_link_codes",
  "slack_installations",
] as const;

/** The team's members (?1 is the team's id). */
const MEMBERS = "(SELECT id FROM core_users WHERE team_id = ?1)";
const MEMBER_ROWS = `user_id IN ${MEMBERS}`;
/** Deleting a team, in order: each row goes before the rows it points at. */
const DELETE_TEAM = [
  "DELETE FROM team_ui_settings WHERE team_id = ?1",
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
  // An operator moves a team to another number (its id is "frc<number>"). Accounts, sessions,
  // kiosks and Slack stay; they just point at the new id. Nothing to do for a team G3ID doesn't
  // have yet (a sign-up that hasn't reached Slack).
  .post("/teams/:id/renumber", async (c) => {
    const id = c.req.param("id");
    const { teamNumber } = await c.req.json<{ teamNumber: number }>();
    if (id === siteTeamId) {
      return c.json({ error: "The site's own team's number is set in site.ts." }, 409);
    }
    if (!Number.isInteger(teamNumber) || teamNumber < 1) {
      return c.json({ error: "Not a team number." }, 400);
    }
    const newId = `frc${teamNumber}`;
    const db = createDb(c.env.DB);
    if (await db.select({ id: teams.id }).from(teams).where(eq(teams.id, newId)).get()) {
      return c.json({ error: `G3ID already has team ${teamNumber}.` }, 409);
    }
    if (!(await db.select({ id: teams.id }).from(teams).where(eq(teams.id, id)).get())) {
      return c.json({ moved: false });
    }
    const now = Math.floor(Date.now() / 1000);
    // The new row first, so every row can point at it; then the old one, with nothing left on it.
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO teams (id, team_number, name, created_at, updated_at) SELECT ?2, ?3, name, created_at, ?4 FROM teams WHERE id = ?1",
      ).bind(id, newId, teamNumber, now),
      ...TEAM_TABLES.map((table) =>
        c.env.DB.prepare(`UPDATE ${table} SET team_id = ?2 WHERE team_id = ?1`).bind(id, newId),
      ),
      c.env.DB.prepare("DELETE FROM teams WHERE id = ?1").bind(id),
    ]);
    return c.json({ moved: true });
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
