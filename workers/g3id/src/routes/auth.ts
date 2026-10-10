import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { createDb } from "../db";
import { coreUserIdentities, coreUserPins, coreUsers, kioskDevices } from "../db/schema";
import { deleteCookieOptions } from "../lib/cookie";
import { regeneratePinForUser } from "../lib/pin";
import { deleteSession, isPinSession } from "../lib/session";
import { slackForTeam } from "../lib/slack-install";
import { requestTeamId, teamOfUser } from "../lib/team";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const authRouter = new Hono<AppEnv>()
  .get("/me", requireAuth, async (c) => {
    const userId = c.get("userId") as string;
    const sessionId = getCookie(c, "g3_session");
    const db = createDb(c.env.DB);

    const user = await db
      .select({
        id: coreUsers.id,
        teamId: coreUsers.teamId,
        email: coreUsers.email,
        displayName: coreUsers.displayName,
        status: coreUsers.status,
        isAdmin: coreUsers.isAdmin,
        isMentor: coreUsers.isMentor,
        createdAt: coreUsers.createdAt,
      })
      .from(coreUsers)
      .where(eq(coreUsers.id, userId))
      .get();

    if (!user) return c.json({ error: "User not found." }, 404);

    const includeIdentities = c.req.query("includeIdentities") !== "false";
    const identities = includeIdentities
      ? await db
          .select({
            id: coreUserIdentities.id,
            provider: coreUserIdentities.provider,
            createdAt: coreUserIdentities.createdAt,
            providerEmail: coreUserIdentities.providerEmail,
            providerId: coreUserIdentities.providerId,
          })
          .from(coreUserIdentities)
          .where(eq(coreUserIdentities.userId, userId))
          .all()
      : [];

    let sessionType: "oauth" | "pin" = "oauth";
    let kioskDeviceId: number | undefined;

    if (sessionId) {
      const metaData = await c.env.SESSIONS.get(`session:${sessionId}:meta`);
      if (metaData) {
        try {
          const parsed = JSON.parse(metaData) as {
            sessionType?: string;
            kioskDeviceId?: number;
          };
          if (parsed.sessionType === "pin") {
            sessionType = "pin";
            kioskDeviceId = parsed.kioskDeviceId;
          }
        } catch {
          // Session metadata is not JSON, treat as oauth
        }
      }
    }

    const isAdmin = sessionType === "pin" ? false : user.isAdmin === 1;
    const isMentor = sessionType === "pin" ? false : user.isMentor === 1;

    let kioskDeviceName: string | undefined;
    if (kioskDeviceId) {
      const device = await db
        .select({ name: kioskDevices.name })
        .from(kioskDevices)
        .where(eq(kioskDevices.id, kioskDeviceId))
        .get();
      kioskDeviceName = device?.name;
    }

    return c.json({
      ...user,
      identities,
      isAdmin,
      isMentor,
      sessionType,
      ...(kioskDeviceId && { kioskDeviceId }),
      ...(kioskDeviceName && { kioskDeviceName }),
    });
  })
  // Resolve a batch of user IDs to public display names. Used by other services
  // (e.g. the shop worker) to show human names instead of raw IDs.
  .get("/users", requireAuth, async (c) => {
    const idsParam = c.req.query("ids") ?? "";
    const ids = [
      ...new Set(
        idsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    if (ids.length === 0) return c.json([] as { id: string; displayName: string }[]);

    const db = createDb(c.env.DB);
    // Names of the caller's own team's members only.
    const team = await teamOfUser(db, c.get("userId") as string);
    const rows = await db
      .select({ id: coreUsers.id, displayName: coreUsers.displayName })
      .from(coreUsers)
      .where(and(inArray(coreUsers.id, ids), eq(coreUsers.teamId, team)))
      .all();

    return c.json(rows);
  })
  .post("/logout", async (c) => {
    const sessionId = getCookie(c, "g3_session");
    let isKiosk = false;

    if (sessionId) {
      isKiosk = await isPinSession(sessionId, c.env);
      await deleteSession(sessionId, c.env);
    }

    deleteCookie(c, "g3_session", deleteCookieOptions(c.req.url));
    return c.json({ ok: true, isKiosk });
  })
  .get("/pin/me", requireAuth, async (c) => {
    const userId = c.get("userId") as string;
    const sessionId = getCookie(c, "g3_session");
    const db = createDb(c.env.DB);

    if (await isPinSession(sessionId, c.env)) {
      return c.json({ error: "PIN sessions cannot view PINs." }, 403);
    }

    const userPin = await db
      .select({ pin: coreUserPins.pin })
      .from(coreUserPins)
      .where(eq(coreUserPins.userId, userId))
      .get();

    if (!userPin) {
      return c.json({ error: "No PIN found." }, 404);
    }

    return c.json({ pin: userPin.pin });
  })
  .post("/pin/regenerate", requireAuth, async (c) => {
    const userId = c.get("userId") as string;
    const sessionId = getCookie(c, "g3_session");

    if (await isPinSession(sessionId, c.env)) {
      return c.json({ error: "PIN sessions cannot regenerate PINs." }, 403);
    }

    const newPin = await regeneratePinForUser(userId, c.env);

    // TODO: Send PIN via Slack DM or email

    return c.json({ pin: newPin });
  })
  .delete("/identities/:identityId", requireAuth, async (c) => {
    const userId = c.get("userId") as string;
    const identityId = c.req.param("identityId");
    const db = createDb(c.env.DB);

    const identity = await db
      .select({ id: coreUserIdentities.id, provider: coreUserIdentities.provider })
      .from(coreUserIdentities)
      // Only one of the caller's own sign-ins.
      .where(and(eq(coreUserIdentities.id, identityId), eq(coreUserIdentities.userId, userId)))
      .get();

    if (!identity) {
      return c.json({ error: "Identity not found." }, 404);
    }

    if (identity.provider === "slack") {
      return c.json({ error: "Cannot unlink Slack." }, 400);
    }

    if (identity.provider !== (c.req.query("provider") ?? identity.provider)) {
      return c.json({ error: "Invalid request." }, 400);
    }

    const identities = await db
      .select({ id: coreUserIdentities.id })
      .from(coreUserIdentities)
      .where(eq(coreUserIdentities.userId, userId))
      .all();

    if (identities.length <= 1) {
      return c.json({ error: "You must keep at least one sign-in method linked." }, 400);
    }

    await db
      .delete(coreUserIdentities)
      .where(and(eq(coreUserIdentities.id, identityId), eq(coreUserIdentities.userId, userId)));

    return c.json({ ok: true });
  })
  // For the Slack sign-in page's "Open Slack" button: the bot in this team's workspace.
  .get("/slack/bot", async (c) => {
    const teamSlack = await slackForTeam(c.env, requestTeamId(c));
    return c.json({
      appId: c.env.SLACK_APP_ID,
      teamId: teamSlack?.workspaceId ?? null,
    });
  });
