import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { createDb } from "../../db";
import { coreUserIdentities } from "../../db/schema";
import { providerRedirectUri, teamFrontend, teamOfUser } from "../../lib/team";
import { requireAuth } from "../../middleware/auth";
import type { AppEnv } from "../../types";

const router = new Hono<AppEnv>();

function generateRandomState(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let state = "";
  for (let i = 0; i < 32; i++) {
    state += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return state;
}

function getSessionType(sessionData: string): string {
  try {
    return (JSON.parse(sessionData) as { sessionType?: string }).sessionType || "";
  } catch {
    return "";
  }
}

router.get("/onshape", requireAuth, async (c) => {
  const userId = c.get("userId");
  const sessionId = getCookie(c, "g3_session");

  if (sessionId) {
    const sessionData = await c.env.SESSIONS.get(sessionId);
    if (sessionData && getSessionType(sessionData) !== "oauth") {
      return c.json({ error: "OnShape linking requires OAuth session" }, 403);
    }
  }

  const state = generateRandomState();
  const stateKey = `oauth_state:${state}`;

  await c.env.RATE_LIMIT.put(stateKey, JSON.stringify({ userId }), {
    expirationTtl: 600, // 10 minutes
  });

  const team = await teamOfUser(createDb(c.env.DB), userId as string);
  const params = new URLSearchParams({
    client_id: c.env.ONSHAPE_CLIENT_ID,
    redirect_uri: providerRedirectUri(c.env, "onshape", team),
    response_type: "code",
    state,
    scope: "OAuth2Read",
  });

  return c.redirect(`https://oauth.onshape.com/oauth/authorize?${params.toString()}`);
});

router.get("/onshape/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400);
  }

  const stateKey = `oauth_state:${state}`;
  const stateData = await c.env.RATE_LIMIT.get(stateKey, "json");

  if (!stateData) {
    return c.json({ error: "Invalid or expired state" }, 400);
  }

  await c.env.RATE_LIMIT.delete(stateKey);

  const stateObj = stateData as { userId: string };
  const userId = stateObj.userId;

  // Exchange code for tokens
  const tokenResponse = await fetch("https://oauth.onshape.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.ONSHAPE_CLIENT_ID,
      client_secret: c.env.ONSHAPE_CLIENT_SECRET,
      redirect_uri: providerRedirectUri(
        c.env,
        "onshape",
        await teamOfUser(createDb(c.env.DB), userId),
      ),
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenResponse.ok) {
    return c.json({ error: "Failed to exchange code for tokens" }, 400);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  // Fetch user info
  const userResponse = await fetch("https://cad.onshape.com/api/users/sessioninfo", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userResponse.ok) {
    return c.json({ error: "Failed to fetch OnShape user info" }, 400);
  }

  const userData = (await userResponse.json()) as { id: string };
  const providerId = userData.id;

  const db = createDb(c.env.DB);

  // Check if this OnShape account is already linked
  const existingIdentity = await db
    .select()
    .from(coreUserIdentities)
    .where(
      and(
        eq(coreUserIdentities.provider, "onshape"),
        eq(coreUserIdentities.providerId, providerId),
      ),
    )
    .get();

  if (existingIdentity) {
    return c.json(
      {
        error: "This Onshape account is already linked to another account.",
      },
      400,
    );
  }

  // Check if user already has OnShape identity
  const existingUserIdentity = await db
    .select()
    .from(coreUserIdentities)
    .where(and(eq(coreUserIdentities.userId, userId), eq(coreUserIdentities.provider, "onshape")))
    .get();

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + tokenData.expires_in;

  if (existingUserIdentity) {
    // Update existing identity
    await db
      .update(coreUserIdentities)
      .set({
        providerId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpiresAt: expiresAt,
        tokenScopes: "OAuth2Read",
      })
      .where(eq(coreUserIdentities.id, existingUserIdentity.id))
      .run();
  } else {
    // Insert new identity
    const id = crypto.randomUUID?.() || `onshape_${userId}_${Date.now()}`;
    await db
      .insert(coreUserIdentities)
      .values({
        id,
        userId,
        provider: "onshape",
        providerId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpiresAt: expiresAt,
        tokenScopes: "OAuth2Read",
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  // Back to the user's own team's G3ID (the callback itself is on the platform's id.<domain>).
  const team = await teamOfUser(createDb(c.env.DB), userId);
  return c.redirect(`${teamFrontend(c.env, team)}/?linked=onshape`);
});

router.delete("/onshape", requireAuth, async (c) => {
  const userIdVal = c.get("userId");
  if (typeof userIdVal !== "string") {
    return c.json({ error: "Invalid user context" }, 400);
  }

  const sessionId = getCookie(c, "g3_session");

  if (sessionId) {
    const sessionData = await c.env.SESSIONS.get(sessionId);
    if (sessionData && getSessionType(sessionData) !== "oauth") {
      return c.json({ error: "OnShape unlinking requires OAuth session" }, 403);
    }
  }

  const db = createDb(c.env.DB);

  await db
    .delete(coreUserIdentities)
    .where(
      and(eq(coreUserIdentities.userId, userIdVal), eq(coreUserIdentities.provider, "onshape")),
    )
    .run();

  return c.json({ success: true });
});

export const onshapeAuthRouter = router;
