import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { kioskActivationCodes, kioskDevices } from "../db/schema";
import { methodOff } from "../lib/sign-in-methods";
import { requireKioskToken } from "../middleware/auth";
import type { AppEnv } from "../types";

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const kioskRouter = new Hono<AppEnv>()
  .post("/kiosk/activate", async (c) => {
    let body: { code?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid request body." }, 400);
    }

    const code = typeof body.code === "string" ? body.code.trim() : "";

    if (!code) {
      return c.json({ error: "Activation code is required." }, 400);
    }

    const db = createDb(c.env.DB);
    const now = Math.floor(Date.now() / 1000);

    const activation = await db
      .select({
        id: kioskActivationCodes.id,
        teamId: kioskActivationCodes.teamId,
        deviceName: kioskActivationCodes.deviceName,
        createdBy: kioskActivationCodes.createdBy,
        expiresAt: kioskActivationCodes.expiresAt,
        used: kioskActivationCodes.used,
      })
      .from(kioskActivationCodes)
      .where(eq(kioskActivationCodes.code, code))
      .get();

    if (!activation) {
      return c.json({ error: "Invalid activation code." }, 400);
    }

    if (activation.used) {
      return c.json({ error: "Activation code already used." }, 400);
    }

    if (activation.expiresAt < now) {
      return c.json({ error: "Activation code expired." }, 400);
    }

    const off = await methodOff(c.env, activation.teamId, "pin");
    if (off) return c.json({ error: off }, 403);

    const token = generateToken();

    const result = await db
      .insert(kioskDevices)
      .values({
        teamId: activation.teamId,
        name: activation.deviceName,
        token,
        createdBy: activation.createdBy,
        createdAt: now,
      })
      .returning({ id: kioskDevices.id });

    await db
      .update(kioskActivationCodes)
      .set({ used: 1 })
      .where(eq(kioskActivationCodes.id, activation.id));

    const deviceId = result[0]?.id;
    return c.json({ token, deviceId });
  })
  .get("/kiosk/verify", requireKioskToken, async (c) => {
    const kioskDeviceId = c.get("kioskDeviceId");
    const db = createDb(c.env.DB);

    const device = await db
      .select({ name: kioskDevices.name, id: kioskDevices.id })
      .from(kioskDevices)
      .where(eq(kioskDevices.id, kioskDeviceId as number))
      .get();

    if (!device) {
      return c.json({ error: "Device not found." }, 404);
    }

    return c.json({ valid: true, deviceId: device.id, deviceName: device.name });
  });
