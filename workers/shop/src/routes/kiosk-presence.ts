import { inTeam, requireAuth, withTeam } from "@g3/auth";
import { eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { kioskPresence } from "../db/schema";
import type { AppEnv } from "../types";

/** Presence entries older than this are considered gone (heartbeats arrive every minute). */
const PRESENCE_TTL_MS = 5 * 60 * 1000;

export const kioskPresenceRouter = new Hono<AppEnv>()
  // Who is logged in at which kiosk right now.
  .get("/", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const rows = await db
      .select()
      .from(kioskPresence)
      .where(
        inTeam(
          kioskPresence,
          c.get("teamId"),
          gt(kioskPresence.updatedAt, Date.now() - PRESENCE_TTL_MS),
        ),
      )
      .all();
    return c.json(rows);
  })
  // Heartbeat from a kiosk session; device identity comes from the g3id session.
  .post("/heartbeat", requireAuth, async (c) => {
    if (c.get("sessionType") !== "pin") {
      return c.json({ error: "Only kiosk sessions can report presence." }, 400);
    }
    const kioskDeviceId = c.get("kioskDeviceId");
    if (!kioskDeviceId) return c.json({ error: "No kiosk device on session." }, 400);

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    await db
      .insert(kioskPresence)
      .values(
        withTeam(teamId, {
          kioskDeviceId,
          deviceName: c.get("kioskDeviceName") ?? `Kiosk ${kioskDeviceId}`,
          userId: c.get("userId"),
          updatedAt: Date.now(),
        }),
      )
      .onConflictDoUpdate({
        target: [kioskPresence.teamId, kioskPresence.kioskDeviceId],
        set: {
          deviceName: c.get("kioskDeviceName") ?? `Kiosk ${kioskDeviceId}`,
          userId: c.get("userId"),
          updatedAt: Date.now(),
        },
      });
    return c.json({ ok: true });
  });

/** Remove a device's presence row (called when its user logs out). */
export async function clearPresence(
  db: ReturnType<typeof createShopDb>,
  teamId: string,
  kioskDeviceId: number,
): Promise<void> {
  try {
    await db
      .delete(kioskPresence)
      .where(inTeam(kioskPresence, teamId, eq(kioskPresence.kioskDeviceId, kioskDeviceId)));
  } catch (err) {
    console.error("Failed to clear kiosk presence:", err);
  }
}
