import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createDb } from "../../db";
import { coreSlackLinkCodes } from "../../db/schema";
import { sessionCookieOptions } from "../../lib/cookie";
import { newId } from "../../lib/id";
import { sanitizeRedirect } from "../../lib/redirect";
import { currentTeamId, teamOfUser } from "../../lib/team";
import { requireAuth } from "../../middleware/auth";
import type { AppEnv } from "../../types";

function generateCode(): string {
  return (crypto.getRandomValues(new Uint32Array(1))[0] % 10000).toString().padStart(4, "0");
}

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const slackAuthRouter = new Hono<AppEnv>()
  // Sign-in initiation — generates code, redirects to /login/slack
  .get("/slack/initiate", async (c) => {
    const redirect = sanitizeRedirect(c.req.query("redirect"));
    const code = generateCode();
    const token = generateToken();
    const now = Math.floor(Date.now() / 1000);
    const db = createDb(c.env.DB);

    await db.insert(coreSlackLinkCodes).values({
      id: newId(),
      teamId: currentTeamId(),
      userId: null,
      code,
      type: "signin",
      pollingToken: token,
      redirectUrl: redirect || null,
      expiresAt: now + 900,
      used: 0,
      createdAt: now,
    });

    const redirectParam = redirect ? `&redirect=${encodeURIComponent(redirect)}` : "";
    return c.redirect(
      `${c.env.FRONTEND_URL}/login/slack?token=${token}&code=${code}${redirectParam}`,
    );
  })
  // Link initiation — user must already be signed in, returns JSON code + token
  .get("/slack/link", requireAuth, async (c) => {
    const userId = c.get("userId") as string;
    const code = generateCode();
    const token = generateToken();
    const now = Math.floor(Date.now() / 1000);
    const db = createDb(c.env.DB);

    await db.insert(coreSlackLinkCodes).values({
      id: newId(),
      teamId: await teamOfUser(db, userId),
      userId,
      code,
      type: "link",
      pollingToken: token,
      expiresAt: now + 900,
      used: 0,
      createdAt: now,
    });

    return c.json({ code, token });
  })
  // Polling — frontend calls this every 2s to check sign-in / link status
  .get("/slack/status", async (c) => {
    const token = c.req.query("token");
    if (!token) return c.json({ status: "expired" });

    const db = createDb(c.env.DB);
    const record = await db
      .select()
      .from(coreSlackLinkCodes)
      .where(eq(coreSlackLinkCodes.pollingToken, token))
      .get();

    if (!record) return c.json({ status: "expired" });
    if (record.status === "pending") return c.json({ status: "pending" });

    if (record.status === "failed") {
      return c.json({ status: "failed", message: record.statusMessage || "Unknown error" });
    }

    if (record.status === "linked") {
      return c.json({ status: "success", action: "linked" });
    }

    if (record.status === "signup_pending") {
      return c.json({ status: "signup_pending" });
    }

    // Status is 'success' with a session ID — set cookie and report success
    if (record.status === "success" && record.sessionId) {
      setCookie(c, "g3_session", record.sessionId, sessionCookieOptions(c.env.FRONTEND_URL));
      return c.json({ status: "success" });
    }

    return c.json({ status: "expired" });
  })
  // Complete — from Slack link, set cookie and redirect (only for successful sign-ins)
  .get("/slack/complete", async (c) => {
    const token = c.req.query("token");
    const redirect = sanitizeRedirect(c.req.query("redirect"));

    if (!token) {
      return c.text("Invalid or missing token", 400);
    }

    const db = createDb(c.env.DB);
    const record = await db
      .select()
      .from(coreSlackLinkCodes)
      .where(eq(coreSlackLinkCodes.pollingToken, token))
      .get();

    if (!record || record.status !== "success" || !record.sessionId) {
      return c.text("Invalid or expired token", 400);
    }

    // Set the session cookie
    setCookie(c, "g3_session", record.sessionId, sessionCookieOptions(c.env.FRONTEND_URL));

    // Redirect to the original URL or home
    const redirectUrl = redirect || `${c.env.FRONTEND_URL}/`;
    return c.redirect(redirectUrl);
  })
  // Cancel — expire the code so it cannot be redeemed
  .delete("/slack/cancel", async (c) => {
    const token = c.req.query("token");
    if (!token) return c.json({ ok: true });

    await createDb(c.env.DB)
      .update(coreSlackLinkCodes)
      .set({ used: 1 })
      .where(eq(coreSlackLinkCodes.pollingToken, token));

    return c.json({ ok: true });
  });
