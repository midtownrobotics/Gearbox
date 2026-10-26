import { leaveGuild } from "@g3/discord";
import { SlackApiError } from "@g3/slack";
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createDb } from "../db";
import {
  coreSessions,
  coreSlackLinkCodes,
  coreUserIdentities,
  coreUserPins,
  coreUsers,
  discordInstallations,
  kioskActivationCodes,
  kioskDevices,
  slackInstallations,
  teamUiSettings,
} from "../db/schema";
import { CHAT_LABELS, chatForTeam, listChatChannels } from "../lib/chat";
import { discordForTeam, removeDiscordInstallation } from "../lib/discord-install";
import { dmMember } from "../lib/member-dm";
import { methodOff } from "../lib/sign-in-methods";
import { NAME_MAX, cleanName } from "../lib/signup-name";
import { removeInstallation, slackForTeam } from "../lib/slack-install";
import { teamOfUser, teamUrl } from "../lib/team";
import { appearanceChanges, logToTeam } from "../lib/team-log";
import { isTeamUiSettings, loadTeamUi, renameTeam } from "../lib/team-ui";
import { requireAdmin } from "../middleware/auth";
import type { AppEnv } from "../types";

/** A user in the admin's own team: an admin only ever sees and changes their team's accounts. */
const memberOf = (team: string, id: string) =>
  and(eq(coreUsers.id, id), eq(coreUsers.teamId, team));

export const adminRouter = new Hono<AppEnv>()
  .use("*", requireAdmin)
  // Everything here is the admin's own team's, so find it once.
  .use("*", async (c, next) => {
    c.set("adminTeamId", await teamOfUser(createDb(c.env.DB), c.get("userId") as string));
    await next();
  })
  // The team's channels on its chat (Slack or Discord), so its admins choose one by name (Shop's
  // channels, the platform's notifications). 404 without a chat; 409 when the team's Slack
  // connection is from before the bot could read channels and has to be connected again.
  .get("/chat/channels", async (c) => {
    const chat = await chatForTeam(c.env, c.get("adminTeamId") as string);
    if (!chat) {
      return c.json(
        { code: "no_chat", error: "Your team hasn't connected Slack or Discord." },
        404,
      );
    }
    try {
      return c.json({ provider: chat.provider, channels: await listChatChannels(chat) });
    } catch (err) {
      if (err instanceof SlackApiError && err.code === "missing_scope") {
        return c.json(
          { code: "reconnect", error: "Connect Slack again so Gearbox can list your channels." },
          409,
        );
      }
      console.error(`[${chat.provider}] listing channels failed`, err);
      return c.json(
        {
          code: "chat_error",
          error: `${CHAT_LABELS[chat.provider]} didn't answer. Please try again.`,
        },
        502,
      );
    }
  })
  // The admin's own team's appearance.
  .get("/team/ui", async (c) => {
    const db = createDb(c.env.DB);
    // The team's defaults too, for the editor's "Reset to defaults".
    return c.json(await loadTeamUi(db, await teamOfUser(db, c.get("userId") as string)));
  })
  .put("/team/ui", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!isTeamUiSettings(body)) return c.json({ error: "Invalid team UI settings." }, 400);
    const now = Math.floor(Date.now() / 1000);
    const db = createDb(c.env.DB);
    const team = await teamOfUser(db, c.get("userId") as string);
    const before = (await loadTeamUi(db, team)).settings;
    await db
      .insert(teamUiSettings)
      .values({
        teamId: team,
        settingsJson: JSON.stringify(body),
        updatedAt: now,
        updatedBy: c.get("userId"),
      })
      .onConflictDoUpdate({
        target: teamUiSettings.teamId,
        set: { settingsJson: JSON.stringify(body), updatedAt: now, updatedBy: c.get("userId") },
      });
    if (body.name.trim() !== before.name.trim()) {
      await renameTeam(c.env, db, team, body.name.trim());
    }
    const changed = appearanceChanges(before, body);
    if (changed.length > 0) {
      await logToTeam(c.env, team, {
        userId: c.get("userId") as string,
        app: "id",
        what: "Team appearance",
        changed,
      });
    }
    return c.json({ settings: body, updatedAt: now });
  })
  .get("/users", async (c) => {
    const db = createDb(c.env.DB);

    const team = c.get("adminTeamId") as string;
    const [users, identities] = await Promise.all([
      db
        .select()
        .from(coreUsers)
        .where(eq(coreUsers.teamId, team))
        .orderBy(desc(coreUsers.createdAt))
        .all(),
      db
        .select({
          userId: coreUserIdentities.userId,
          provider: coreUserIdentities.provider,
          providerEmail: coreUserIdentities.providerEmail,
          createdAt: coreUserIdentities.createdAt,
        })
        .from(coreUserIdentities)
        .innerJoin(coreUsers, eq(coreUsers.id, coreUserIdentities.userId))
        .where(eq(coreUsers.teamId, team))
        .all(),
    ]);

    // Each sign-in with the account's name there (an email or username), so the list can be
    // searched by it.
    const identitiesByUser = new Map<
      string,
      { provider: string; providerEmail: string | null; createdAt: number }[]
    >();
    for (const { userId, ...identity } of identities) {
      const list = identitiesByUser.get(userId) ?? [];
      list.push(identity);
      identitiesByUser.set(userId, list);
    }

    return c.json(
      users.map((user) => ({
        ...user,
        identities: identitiesByUser.get(user.id) ?? [],
      })),
    );
  })
  // One member in full, for their page in the Users list: their sign-ins (the account's name at
  // each service and when it was linked) and whether they have a kiosk PIN (never the PIN).
  .get("/users/:id", async (c) => {
    const db = createDb(c.env.DB);
    const user = await db
      .select({
        id: coreUsers.id,
        email: coreUsers.email,
        displayName: coreUsers.displayName,
        username: coreUsers.username,
        needsName: coreUsers.needsName,
        status: coreUsers.status,
        isAdmin: coreUsers.isAdmin,
        isMentor: coreUsers.isMentor,
        createdAt: coreUsers.createdAt,
        lastLoginAt: coreUsers.lastLoginAt,
        lastSeenAt: coreUsers.lastSeenAt,
      })
      .from(coreUsers)
      .where(memberOf(c.get("adminTeamId") as string, c.req.param("id")))
      .get();
    if (!user) return c.json({ error: "User not found." }, 404);
    const [identities, pin] = await Promise.all([
      db
        .select({
          provider: coreUserIdentities.provider,
          providerEmail: coreUserIdentities.providerEmail,
          createdAt: coreUserIdentities.createdAt,
        })
        .from(coreUserIdentities)
        .where(eq(coreUserIdentities.userId, user.id))
        .orderBy(coreUserIdentities.createdAt)
        .all(),
      db
        .select({ createdAt: coreUserPins.createdAt })
        .from(coreUserPins)
        .where(eq(coreUserPins.userId, user.id))
        .get(),
    ]);
    return c.json({ ...user, identities, kioskPinSince: pin?.createdAt ?? null });
  })
  // A member's name, which an admin can correct. Their username (their chat account's name)
  // stays as it is. Someone still to enter their own name keeps the admin's instead.
  .put(
    "/users/:id/name",
    validator("json", (value, c) => {
      const name = cleanName((value as { name?: unknown } | null)?.name);
      if (!name) return c.json({ error: `Enter a name of up to ${NAME_MAX} characters.` }, 400);
      return { name };
    }),
    async (c) => {
      const { name } = c.req.valid("json");
      const updated = await createDb(c.env.DB)
        .update(coreUsers)
        .set({ displayName: name, needsName: 0, updatedAt: Math.floor(Date.now() / 1000) })
        .where(memberOf(c.get("adminTeamId") as string, c.req.param("id")))
        .returning({ id: coreUsers.id });
      if (updated.length === 0) return c.json({ error: "User not found." }, 404);
      return c.json({ displayName: name });
    },
  )
  .post("/users/:id/approve", async (c) => {
    const id = c.req.param("id");
    const db = createDb(c.env.DB);

    const user = await db
      .select({ id: coreUsers.id, teamId: coreUsers.teamId, status: coreUsers.status })
      .from(coreUsers)
      .where(memberOf(c.get("adminTeamId") as string, id))
      .get();

    if (!user) return c.json({ error: "User not found." }, 404);
    if (user.status !== "pending") return c.json({ error: "User is not pending." }, 400);

    await db
      .update(coreUsers)
      .set({ status: "active", updatedAt: Math.floor(Date.now() / 1000) })
      .where(memberOf(c.get("adminTeamId") as string, id));

    // They hear it on the team's chat, where they signed up. Never fails the approval.
    const chat = await chatForTeam(c.env, user.teamId);
    if (chat) {
      const how =
        chat.provider === "slack"
          ? "**sign in with Slack**. Yes, you will have to repeat the code sending process."
          : "**sign in with Discord**.";
      await dmMember(
        c.env,
        user.teamId,
        id,
        `✅ Your ID account has been approved! [Go to the sign-in page](${teamUrl(c.env, user.teamId, "id")}/login) and ${how}`,
      ).catch((err) => console.error("[chat] approval DM failed", err));
    }

    return c.json({ message: "User approved." });
  })
  .post("/users/:id/reject", async (c) => {
    const id = c.req.param("id");
    const db = createDb(c.env.DB);

    const user = await db
      .select({ id: coreUsers.id, status: coreUsers.status })
      .from(coreUsers)
      .where(memberOf(c.get("adminTeamId") as string, id))
      .get();

    if (!user) return c.json({ error: "User not found." }, 404);
    if (user.status !== "pending") return c.json({ error: "User is not pending." }, 400);

    await db
      .update(coreUsers)
      .set({ status: "rejected", updatedAt: Math.floor(Date.now() / 1000) })
      .where(memberOf(c.get("adminTeamId") as string, id));

    return c.json({ message: "User rejected." });
  })
  .post("/users/:id/merge", async (c) => {
    const id = c.req.param("id");

    let body: { targetUserId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request body." }, 400);
    }

    const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId.trim() : "";
    if (!targetUserId || targetUserId === id) {
      return c.json({ error: "Invalid target user." }, 400);
    }

    const db = createDb(c.env.DB);

    const [source, target] = await Promise.all([
      db
        .select({ id: coreUsers.id, status: coreUsers.status })
        .from(coreUsers)
        .where(memberOf(c.get("adminTeamId") as string, id))
        .get(),
      db
        .select({ id: coreUsers.id, status: coreUsers.status })
        .from(coreUsers)
        .where(memberOf(c.get("adminTeamId") as string, targetUserId))
        .get(),
    ]);

    if (!source) return c.json({ error: "User not found." }, 404);
    if (!target) return c.json({ error: "Target user not found." }, 404);
    if (source.status === "active") return c.json({ error: "Active users cannot be merged." }, 400);
    if (source.status === "merged") return c.json({ error: "User is already merged." }, 400);
    if (target.status === "merged")
      return c.json({ error: "Cannot merge into a merged user." }, 400);

    const [sourceIdentities, targetIdentities] = await Promise.all([
      db
        .select({ provider: coreUserIdentities.provider })
        .from(coreUserIdentities)
        .where(eq(coreUserIdentities.userId, id))
        .all(),
      db
        .select({ provider: coreUserIdentities.provider })
        .from(coreUserIdentities)
        .where(eq(coreUserIdentities.userId, targetUserId))
        .all(),
    ]);

    const targetProviders = new Set(targetIdentities.map((i) => i.provider));
    const conflict = sourceIdentities.find((i) => targetProviders.has(i.provider));
    if (conflict) {
      return c.json(
        { error: `Target user already has a ${conflict.provider} account. Cannot merge.` },
        409,
      );
    }

    const now = Math.floor(Date.now() / 1000);

    await db.batch([
      db
        .update(coreUserIdentities)
        .set({ userId: targetUserId, updatedAt: now })
        .where(eq(coreUserIdentities.userId, id)),
      db.update(coreSessions).set({ userId: targetUserId }).where(eq(coreSessions.userId, id)),
    ]);

    // Source user's identities and sessions are now on the target — delete the shell
    await db.delete(coreSlackLinkCodes).where(eq(coreSlackLinkCodes.userId, id));
    await db.delete(coreUsers).where(memberOf(c.get("adminTeamId") as string, id));

    return c.json({ message: "User merged." });
  })
  .delete("/users/:id", async (c) => {
    const id = c.req.param("id");
    const actorId = c.get("userId") as string;
    if (id === actorId) return c.json({ error: "You can't delete your own account." }, 400);
    const team = c.get("adminTeamId") as string;
    const db = createDb(c.env.DB);

    const user = await db
      .select({ id: coreUsers.id, status: coreUsers.status })
      .from(coreUsers)
      .where(memberOf(team, id))
      .get();

    if (!user) return c.json({ error: "User not found." }, 404);
    if (user.status === "pending") {
      return c.json({ error: "Pending users must be rejected before deletion." }, 400);
    }

    // Accounts merged into this one long ago were left as empty shells pointing at it: they go
    // with it.
    const shells = await db
      .select({ id: coreUsers.id })
      .from(coreUsers)
      .where(and(eq(coreUsers.teamId, team), eq(coreUsers.mergedIntoUserId, id)))
      .all();
    const ids = [id, ...shells.map((shell) => shell.id)];
    const sessions = await db
      .select({ id: coreSessions.id })
      .from(coreSessions)
      .where(inArray(coreSessions.userId, ids))
      .all();

    // Everything that points at the account goes before it, in one batch, so it is all deleted or
    // none of it is. (One step at a time, an account with a kiosk PIN lost its sign-ins and then
    // couldn't be deleted.)
    await db.batch([
      db.delete(coreSlackLinkCodes).where(inArray(coreSlackLinkCodes.userId, ids)),
      db.delete(coreSessions).where(inArray(coreSessions.userId, ids)),
      db.delete(coreUserPins).where(inArray(coreUserPins.userId, ids)),
      db.delete(coreUserIdentities).where(inArray(coreUserIdentities.userId, ids)),
      db.delete(kioskActivationCodes).where(inArray(kioskActivationCodes.createdBy, ids)),
      // The team's kiosks and its Slack connection stay: the admin deleting the account takes
      // over the kiosks it set up.
      db
        .update(kioskDevices)
        .set({ createdBy: actorId })
        .where(inArray(kioskDevices.createdBy, ids)),
      db
        .update(slackInstallations)
        .set({ installedBy: null })
        .where(inArray(slackInstallations.installedBy, ids)),
      db
        .update(discordInstallations)
        .set({ installedBy: null })
        .where(inArray(discordInstallations.installedBy, ids)),
      db.delete(coreUsers).where(and(eq(coreUsers.teamId, team), inArray(coreUsers.id, ids))),
    ]);
    // Sessions are looked up in KV; without their user they'd fail anyway, but don't leave them.
    await Promise.all(
      sessions.flatMap(({ id: session }) => [
        c.env.SESSIONS.delete(`session:${session}`),
        c.env.SESSIONS.delete(`session:${session}:meta`),
      ]),
    );

    return c.json({ message: "User deleted." });
  })
  .post("/users/:id/promote", async (c) => {
    const id = c.req.param("id");
    const db = createDb(c.env.DB);

    const user = await db
      .select({ id: coreUsers.id })
      .from(coreUsers)
      .where(memberOf(c.get("adminTeamId") as string, id))
      .get();

    if (!user) return c.json({ error: "User not found." }, 404);

    await db
      .update(coreUsers)
      .set({ isAdmin: 1, updatedAt: Math.floor(Date.now() / 1000) })
      .where(memberOf(c.get("adminTeamId") as string, id));

    return c.json({ message: "User promoted to admin." });
  })
  .post("/users/:id/demote", async (c) => {
    const id = c.req.param("id");
    const actorId = c.get("userId");
    if (id === actorId) return c.json({ error: "Cannot demote yourself." }, 400);

    const db = createDb(c.env.DB);

    const user = await db
      .select({ id: coreUsers.id })
      .from(coreUsers)
      .where(memberOf(c.get("adminTeamId") as string, id))
      .get();

    if (!user) return c.json({ error: "User not found." }, 404);

    await db
      .update(coreUsers)
      .set({ isAdmin: 0, updatedAt: Math.floor(Date.now() / 1000) })
      .where(memberOf(c.get("adminTeamId") as string, id));

    return c.json({ message: "User demoted." });
  })
  .post("/users/:id/grant-mentor", async (c) => {
    const id = c.req.param("id");
    const db = createDb(c.env.DB);

    const user = await db
      .select({ id: coreUsers.id })
      .from(coreUsers)
      .where(memberOf(c.get("adminTeamId") as string, id))
      .get();

    if (!user) return c.json({ error: "User not found." }, 404);

    await db
      .update(coreUsers)
      .set({ isMentor: 1, updatedAt: Math.floor(Date.now() / 1000) })
      .where(memberOf(c.get("adminTeamId") as string, id));

    return c.json({ message: "User granted mentor." });
  })
  .post("/users/:id/revoke-mentor", async (c) => {
    const id = c.req.param("id");
    const db = createDb(c.env.DB);

    const user = await db
      .select({ id: coreUsers.id })
      .from(coreUsers)
      .where(memberOf(c.get("adminTeamId") as string, id))
      .get();

    if (!user) return c.json({ error: "User not found." }, 404);

    await db
      .update(coreUsers)
      .set({ isMentor: 0, updatedAt: Math.floor(Date.now() / 1000) })
      .where(memberOf(c.get("adminTeamId") as string, id));

    return c.json({ message: "Mentor revoked." });
  })
  .post("/kiosk/codes", async (c) => {
    const userId = c.get("userId") as string;
    const off = await methodOff(c.env, c.get("adminTeamId") as string, "pin");
    if (off) return c.json({ error: off }, 403);
    let body: { deviceName?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request body." }, 400);
    }

    const deviceName = typeof body.deviceName === "string" ? body.deviceName.trim() : "";
    if (!deviceName) {
      return c.json({ error: "Device name is required." }, 400);
    }

    const code = (crypto.getRandomValues(new Uint32Array(1))[0] % 1000000)
      .toString()
      .padStart(6, "0");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 30 * 60;

    const db = createDb(c.env.DB);

    await db.insert(kioskActivationCodes).values({
      teamId: c.get("adminTeamId") as string,
      code,
      createdBy: userId,
      deviceName,
      expiresAt,
      createdAt: now,
    });

    return c.json({ code, expiresAt });
  })
  // The team's Slack workspace, which an admin connects with /slack/install.
  .get("/slack", async (c) => {
    const team = await teamOfUser(createDb(c.env.DB), c.get("userId") as string);
    const teamSlack = await slackForTeam(c.env, team);
    return c.json({
      connected: teamSlack !== null,
      workspaceId: teamSlack?.workspaceId ?? null,
      workspaceName: teamSlack?.workspaceName ?? null,
      fromSettings: teamSlack?.fromSettings ?? false,
      canConnect: Boolean(c.env.SLACK_CLIENT_ID && c.env.SECRETS_KEY),
    });
  })
  // The team's Discord server, which an admin connects with /auth/discord/install.
  .get("/discord", async (c) => {
    const teamDiscord = await discordForTeam(c.env, c.get("adminTeamId") as string);
    return c.json({
      connected: teamDiscord !== null,
      guildId: teamDiscord?.guildId ?? null,
      guildName: teamDiscord?.guildName ?? null,
    });
  })
  // Disconnects Discord: the bot leaves the server and the team forgets it.
  .delete("/discord", async (c) => {
    const team = c.get("adminTeamId") as string;
    const teamDiscord = await discordForTeam(c.env, team);
    if (teamDiscord) {
      await leaveGuild({ DISCORD_BOT_TOKEN: c.env.DISCORD_BOT_TOKEN }, teamDiscord.guildId).catch(
        (err) => console.error("[discord] leaving the server failed", err),
      );
    }
    await removeDiscordInstallation(c.env, team);
    await logToTeam(c.env, team, {
      userId: c.get("userId") as string,
      app: "id",
      what: "Discord disconnected",
    });
    return c.json({ ok: true });
  })
  .delete("/slack", async (c) => {
    const team = await teamOfUser(createDb(c.env.DB), c.get("userId") as string);
    await removeInstallation(c.env, { teamId: team });
    await logToTeam(c.env, team, {
      userId: c.get("userId") as string,
      app: "id",
      what: "Slack disconnected",
    });
    return c.json({ ok: true });
  })
  .get("/kiosk/devices", async (c) => {
    const db = createDb(c.env.DB);
    const now = Math.floor(Date.now() / 1000);
    const fifteenMinutesAgo = now - 15 * 60;

    const devices = await db
      .select()
      .from(kioskDevices)
      .where(
        and(
          eq(kioskDevices.teamId, c.get("adminTeamId") as string),
          or(isNull(kioskDevices.revokedAt), gt(kioskDevices.revokedAt, fifteenMinutesAgo)),
        ),
      )
      .all();
    return c.json(devices);
  })
  .delete("/kiosk/devices/:id", async (c) => {
    const id = c.req.param("id");
    const deviceId = Number.parseInt(id, 10);

    if (Number.isNaN(deviceId)) {
      return c.json({ error: "Invalid device ID." }, 400);
    }

    const db = createDb(c.env.DB);
    const now = Math.floor(Date.now() / 1000);

    const device = await db
      .select({ id: kioskDevices.id })
      .from(kioskDevices)
      .where(
        and(eq(kioskDevices.id, deviceId), eq(kioskDevices.teamId, c.get("adminTeamId") as string)),
      )
      .get();

    if (!device) {
      return c.json({ error: "Device not found." }, 404);
    }

    await db.update(kioskDevices).set({ revokedAt: now }).where(eq(kioskDevices.id, deviceId));

    return c.json({ success: true });
  });
