import { resolveUserId } from "@g3/auth";
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { createDb } from "../db";
import { coreUsers, kioskDevices } from "../db/schema";
import type { AppEnv } from "../types";

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const userId = await resolveUserId(c.req.header("Cookie") ?? "", c.env);
  if (!userId) return c.json({ error: "Unauthorized." }, 401);
  c.set("userId", userId);
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const userId = await resolveUserId(c.req.header("Cookie") ?? "", c.env);
  if (!userId) return c.json({ error: "Unauthorized." }, 401);

  const sessionId = getCookie(c, "g3_session");
  if (sessionId) {
    const metaData = await c.env.SESSIONS.get(`session:${sessionId}:meta`);
    if (metaData) {
      try {
        const parsed = JSON.parse(metaData) as { sessionType?: string };
        if (parsed.sessionType === "pin") {
          return c.json({ error: "Admin access not allowed from kiosk." }, 403);
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  const db = createDb(c.env.DB);
  const user = await db
    .select({ status: coreUsers.status, isAdmin: coreUsers.isAdmin })
    .from(coreUsers)
    .where(eq(coreUsers.id, userId))
    .get();

  if (!user || user.status !== "active" || !user.isAdmin) {
    return c.json({ error: "Forbidden." }, 403);
  }

  c.set("userId", userId);
  await next();
});

export const requireActive = createMiddleware<AppEnv>(async (c, next) => {
  const userId = await resolveUserId(c.req.header("Cookie") ?? "", c.env);
  if (!userId) return c.json({ error: "Unauthorized." }, 401);

  const db = createDb(c.env.DB);
  const user = await db
    .select({ status: coreUsers.status })
    .from(coreUsers)
    .where(eq(coreUsers.id, userId))
    .get();

  if (!user || user.status !== "active") return c.json({ error: "Forbidden." }, 403);

  c.set("userId", userId);
  await next();
});

export const requireKioskToken = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.header("X-Kiosk-Token");
  if (!token) return c.json({ error: "Missing kiosk token." }, 401);

  const db = createDb(c.env.DB);
  const device = await db
    .select({ id: kioskDevices.id, teamId: kioskDevices.teamId, revokedAt: kioskDevices.revokedAt })
    .from(kioskDevices)
    .where(eq(kioskDevices.token, token))
    .get();

  if (!device || device.revokedAt !== null) {
    return c.json({ error: "Invalid or revoked kiosk token." }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  await db.update(kioskDevices).set({ lastUsedAt: now }).where(eq(kioskDevices.id, device.id));

  c.set("kioskDeviceId", device.id);
  c.set("kioskTeamId", device.teamId);
  await next();
});
