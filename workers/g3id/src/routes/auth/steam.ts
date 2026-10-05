import { resolveUserId } from "@g3/auth";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createDb } from "../../db";
import { coreUserIdentities, coreUsers } from "../../db/schema";
import { sessionCookieOptions } from "../../lib/cookie";
import { decodeState, encodeState } from "../../lib/oauth-state";
import { sanitizeRedirect } from "../../lib/redirect";
import { createSession } from "../../lib/session";
import { requestTeamId, teamFrontend, teamOfUser } from "../../lib/team";
import type { AppEnv } from "../../types";

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
const STEAM_ID_REGEX = /https:\/\/steamcommunity\.com\/openid\/id\/(\d+)/;

async function generateState(env: AppEnv["Bindings"], value: string): Promise<string> {
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await env.RATE_LIMIT.put(`oauth_state:${state}`, value, { expirationTtl: 600 });
  return state;
}

function buildSteamUrl(redirectUri: string, state: string): string {
  const returnTo = `${redirectUri}?state=${state}`;
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": new URL(redirectUri).origin,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${STEAM_OPENID_URL}?${params}`;
}

export const steamAuthRouter = new Hono<AppEnv>()
  // Sign-in initiation
  .get("/steam", async (c) => {
    const team = requestTeamId(c);
    const redirect = sanitizeRedirect(c.req.query("redirect"), team);
    const state = await generateState(c.env, encodeState({ team, redirect, linkUserId: null }));
    return c.redirect(buildSteamUrl(c.env.STEAM_REDIRECT_URI, state));
  })
  // Link initiation — user must already be signed in
  .get("/steam/link", async (c) => {
    const app = (path: string) => `${c.env.FRONTEND_URL}${path}`;
    const userId = await resolveUserId(c.req.header("Cookie") ?? "", c.env);
    if (!userId) return c.redirect(app("/login"));

    const team = await teamOfUser(createDb(c.env.DB), userId);
    const state = await generateState(
      c.env,
      encodeState({ team, redirect: null, linkUserId: userId }),
    );
    return c.redirect(buildSteamUrl(c.env.STEAM_REDIRECT_URI, state));
  })
  // Shared callback
  .get("/steam/callback", async (c) => {
    // Until the state says which team this is, errors go to the site team's page.
    let frontend = c.env.FRONTEND_URL;
    const app = (path: string) => `${frontend}${path}`;
    const err = (msg: string) => c.redirect(app(`/login/error?error=${encodeURIComponent(msg)}`));

    const state = c.req.query("state");
    if (!state) return err("Missing state parameter.");

    const stateValue = await c.env.RATE_LIMIT.get(`oauth_state:${state}`);
    await c.env.RATE_LIMIT.delete(`oauth_state:${state}`);
    if (!stateValue) return err("This sign-in link has expired. Please try again.");

    const st = decodeState(stateValue);
    frontend = teamFrontend(c.env, st.team);
    const linkUserId = st.linkUserId;
    const isLink = linkUserId !== null;
    const redirectTo = st.redirect?.startsWith("/") ? app(st.redirect) : st.redirect;

    const claimedId = c.req.query("openid.claimed_id");
    if (!claimedId) return err("Invalid OpenID response.");

    const match = STEAM_ID_REGEX.exec(claimedId);
    if (!match) return err("Invalid Steam identity.");
    const steamId = match[1];

    // Verify with Steam — always POST to the hardcoded endpoint, never trust openid.op_endpoint
    const verifyParams = new URLSearchParams({ "openid.mode": "check_authentication" });
    for (const [key, value] of Object.entries(c.req.query())) {
      if (key !== "state" && key !== "openid.mode") {
        verifyParams.set(key, value as string);
      }
    }

    const verifyRes = await fetch(STEAM_OPENID_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: verifyParams.toString(),
    });

    if (!verifyRes.ok) return err("Failed to verify Steam sign-in. Please try again.");
    const verifyText = await verifyRes.text();
    if (!verifyText.includes("is_valid:true")) {
      return err("Steam sign-in could not be verified. Please try again.");
    }

    const db = createDb(c.env.DB);

    // --- Link flow ---
    if (isLink && linkUserId) {
      const linkUser = await db
        .select({ id: coreUsers.id, status: coreUsers.status })
        .from(coreUsers)
        .where(eq(coreUsers.id, linkUserId))
        .get();

      if (!linkUser || linkUser.status !== "active") {
        return err("Your account is not active.");
      }

      const existingIdentity = await db
        .select({ userId: coreUserIdentities.userId })
        .from(coreUserIdentities)
        .where(
          and(eq(coreUserIdentities.provider, "steam"), eq(coreUserIdentities.providerId, steamId)),
        )
        .get();

      if (existingIdentity) {
        if (existingIdentity.userId === linkUserId) return c.redirect(app("/dashboard"));
        return err("This Steam account is already linked to a different account.");
      }

      const now = Math.floor(Date.now() / 1000);
      await db.insert(coreUserIdentities).values({
        id: crypto.randomUUID(),
        userId: linkUserId,
        provider: "steam",
        providerId: steamId,
        createdAt: now,
        updatedAt: now,
      });
      return c.redirect(app("/dashboard"));
    }

    // --- Sign-in flow ---
    const identity = await db
      .select({ userId: coreUserIdentities.userId })
      .from(coreUserIdentities)
      .where(
        and(eq(coreUserIdentities.provider, "steam"), eq(coreUserIdentities.providerId, steamId)),
      )
      .get();

    if (!identity) {
      return c.redirect(
        app(
          `/login?error=${encodeURIComponent("You need to link Steam from your account settings first.")}`,
        ),
      );
    }

    const user = await db
      .select({ id: coreUsers.id, teamId: coreUsers.teamId, status: coreUsers.status })
      .from(coreUsers)
      .where(eq(coreUsers.id, identity.userId))
      .get();

    if (user && user.teamId !== st.team) {
      return err("This account belongs to another team. Sign in on your own team's page.");
    }

    if (!user || user.status !== "active") {
      const message =
        user?.status === "pending"
          ? "Your account is awaiting admin approval."
          : "Your account is not active.";
      return err(message);
    }

    const sessionId = await createSession(user.id, c.env);
    setCookie(c, "g3_session", sessionId, sessionCookieOptions(c.env.FRONTEND_URL));
    return c.redirect(redirectTo ?? app("/dashboard"));
  });
