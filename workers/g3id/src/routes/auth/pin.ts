import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createDb } from "../../db";
import { coreUserPins, coreUsers } from "../../db/schema";
import { sessionCookieOptions } from "../../lib/cookie";
import { createSession } from "../../lib/session";
import { methodOff } from "../../lib/sign-in-methods";
import { requireKioskToken } from "../../middleware/auth";
import type { AppEnv } from "../../types";

export const pinAuthRouter = new Hono<AppEnv>().post("/pin", requireKioskToken, async (c) => {
  let body: { pin?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body." }, 400);
  }

  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (!pin) {
    return c.json({ error: "PIN is required." }, 400);
  }

  const off = await methodOff(c.env, c.get("kioskTeamId") as string, "pin");
  if (off) return c.json({ error: off }, 403);

  // PINs are unique within a team, and a kiosk signs in only its own team's members.
  const db = createDb(c.env.DB);
  const userPin = await db
    .select({ userId: coreUserPins.userId })
    .from(coreUserPins)
    .where(and(eq(coreUserPins.teamId, c.get("kioskTeamId") as string), eq(coreUserPins.pin, pin)))
    .get();

  if (!userPin) {
    return c.json({ error: "Invalid PIN." }, 400);
  }

  const user = await db
    .select({ status: coreUsers.status })
    .from(coreUsers)
    .where(eq(coreUsers.id, userPin.userId))
    .get();

  if (!user || user.status !== "active") {
    return c.json({ error: "User account is not active." }, 403);
  }

  const kioskDeviceId = c.get("kioskDeviceId") as number;
  const sessionId = await createSession(userPin.userId, c.env);
  await c.env.SESSIONS.put(
    `session:${sessionId}:meta`,
    JSON.stringify({ sessionType: "pin", kioskDeviceId }),
    { expirationTtl: 7 * 24 * 60 * 60 },
  );

  setCookie(c, "g3_session", sessionId, sessionCookieOptions(c.req.url));

  return c.json({ success: true });
});
