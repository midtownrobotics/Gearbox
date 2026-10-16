import { resolveUserId } from "@g3/auth";
import { authorizeUrl, exchangeCode } from "@g3/discord";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createDb } from "../../db";
import { coreUserIdentities, coreUsers } from "../../db/schema";
import { sessionCookieOptions } from "../../lib/cookie";
import { saveDiscordInstallation } from "../../lib/discord-install";
import { signInWithDiscord } from "../../lib/discord-sign-in";
import { takeHandoff } from "../../lib/handoff";
import { newId } from "../../lib/id";
import { type OAuthState, decodeState, encodeState } from "../../lib/oauth-state";
import { sanitizeRedirect } from "../../lib/redirect";
import { methodOff } from "../../lib/sign-in-methods";
import {
  providerRedirectUri,
  requestTeamId,
  teamFrontend,
  teamOfUser,
  teamUrl,
} from "../../lib/team";
import { logToTeam } from "../../lib/team-log";
import { requireAdmin } from "../../middleware/auth";
import type { AppEnv } from "../../types";

// Discord: signing in, linking it to an account, and an admin adding the team's bot to its
// server, all through Discord's OAuth (docs/roadmap/discord.md). They share one callback, so one
// address is registered with Discord. Sign-in works like Google's; someone new is signed up only
// if they're in the team's server (lib/discord-sign-in.ts).

type Env = AppEnv["Bindings"];

/** What the trip to Discord remembers: a sign-in or link, or the admin adding the bot. */
type DiscordState = OAuthState & { installBy?: string | null };

async function saveState(env: Env, state: DiscordState): Promise<string> {
  const key = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await env.RATE_LIMIT.put(`oauth_state:${key}`, encodeState(state), { expirationTtl: 600 });
  return key;
}

const app = (env: Env) => ({ DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID });

export const discordAuthRouter = new Hono<AppEnv>()
  // A sign-in finished elsewhere (the platform's sign-up with Discord), spent on the team's own
  // address so the cookie is set on its domain (lib/handoff.ts).
  .get("/handoff", async (c) => {
    const handoff = await takeHandoff(c.env, c.req.query("token") ?? "");
    const team = requestTeamId(c);
    if (!handoff || handoff.teamId !== team) return c.text("Invalid or expired link.", 400);
    setCookie(c, "g3_session", handoff.sessionId, sessionCookieOptions(c.req.url));
    const redirect = sanitizeRedirect(c.req.query("redirect"), team);
    return c.redirect(redirect || `${teamUrl(c.env, team, "portal")}/`);
  })
  // Sign-in initiation.
  .get("/discord", async (c) => {
    const team = requestTeamId(c);
    const error = (msg: string) =>
      c.redirect(`${teamFrontend(c.env, team)}/login/error?error=${encodeURIComponent(msg)}`);
    const off = await methodOff(c.env, team, "discord");
    if (off) return error(off);
    const redirect = sanitizeRedirect(c.req.query("redirect"), team);
    const state = await saveState(c.env, { team, redirect, linkUserId: null });
    return c.redirect(
      authorizeUrl(app(c.env), {
        redirectUri: providerRedirectUri(c.env, "discord", team),
        state,
      }),
    );
  })
  // Link initiation: a signed-in member adds Discord to their account.
  .get("/discord/link", async (c) => {
    const userId = await resolveUserId(c.req.header("Cookie") ?? "", c.env);
    if (!userId) return c.redirect(`${c.env.FRONTEND_URL}/login`);
    const team = await teamOfUser(createDb(c.env.DB), userId);
    const error = (msg: string) =>
      c.redirect(`${teamFrontend(c.env, team)}/login/error?error=${encodeURIComponent(msg)}`);
    const off = await methodOff(c.env, team, "discord");
    if (off) return error(off);
    const state = await saveState(c.env, { team, redirect: null, linkUserId: userId });
    return c.redirect(
      authorizeUrl(app(c.env), {
        redirectUri: providerRedirectUri(c.env, "discord", team),
        state,
      }),
    );
  })
  // A team admin adds the bot to the team's Discord server (from Portal's Integrations page).
  .get("/discord/install", requireAdmin, async (c) => {
    const userId = c.get("userId") as string;
    const team = await teamOfUser(createDb(c.env.DB), userId);
    const state = await saveState(c.env, {
      team,
      redirect: null,
      linkUserId: null,
      installBy: userId,
    });
    return c.redirect(
      authorizeUrl(app(c.env), {
        redirectUri: providerRedirectUri(c.env, "discord", team),
        state,
        install: true,
      }),
    );
  })
  .get("/discord/callback", async (c) => {
    // Until the state says which team this is, errors go to the site team's page.
    let frontend = c.env.FRONTEND_URL;
    const err = (msg: string) =>
      c.redirect(`${frontend}/login/error?error=${encodeURIComponent(msg)}`);

    const key = c.req.query("state");
    const stateValue = key ? await c.env.RATE_LIMIT.get(`oauth_state:${key}`) : null;
    if (key) await c.env.RATE_LIMIT.delete(`oauth_state:${key}`);
    if (!stateValue) return err("This sign-in link has expired. Please try again.");
    const st = decodeState(stateValue) as DiscordState;
    frontend = teamFrontend(c.env, st.team);
    const integrations = (query: string) =>
      c.redirect(`${teamUrl(c.env, st.team, "portal")}/admin/integrations?${query}`);

    const code = c.req.query("code");
    if (c.req.query("error") || !code) {
      return st.installBy
        ? integrations(`error=${encodeURIComponent("Discord wasn't connected.")}`)
        : err("Sign-in was canceled or denied.");
    }

    const done = await exchangeCode(
      {
        DISCORD_CLIENT_ID: c.env.DISCORD_CLIENT_ID,
        DISCORD_CLIENT_SECRET: c.env.DISCORD_CLIENT_SECRET,
      },
      code,
      providerRedirectUri(c.env, "discord", st.team),
    );

    // --- An admin adding the bot ---
    if (st.installBy) {
      const fail = (msg: string) => integrations(`error=${encodeURIComponent(msg)}`);
      if (!done?.guild) return fail("Discord didn't finish connecting. Please try again.");
      const result = await saveDiscordInstallation(c.env, {
        teamId: st.team,
        guildId: done.guild.id,
        guildName: done.guild.name,
        installedBy: st.installBy,
      });
      if (result === "taken")
        return fail("That Discord server is already connected to another team.");
      if (result === "slack") return fail("Disconnect Slack before connecting Discord.");
      // The admin who added it can sign in with it too.
      await linkIdentity(c.env, st.installBy, done.user.id, done.user.email);
      await logToTeam(c.env, st.team, {
        userId: st.installBy,
        app: "id",
        what: "Discord connected",
        changed: [done.guild.name],
      });
      return integrations("connected=discord");
    }

    if (!done) return err("Failed to complete sign-in with Discord. Please try again.");
    const off = await methodOff(c.env, st.team, "discord");
    if (off) return err(off);

    // --- Link ---
    if (st.linkUserId) {
      const linked = await linkIdentity(c.env, st.linkUserId, done.user.id, done.user.email);
      if (linked !== "ok") return err(linked);
      return c.redirect(`${teamUrl(c.env, st.team, "portal")}/account`);
    }

    // --- Sign-in (or sign-up) ---
    const signIn = await signInWithDiscord(c.env, st.team, done.user);
    if (signIn.result === "failed") return err(signIn.message);
    if (signIn.result === "pending") return c.redirect(`${frontend}/signup/pending`);
    setCookie(c, "g3_session", signIn.sessionId, sessionCookieOptions(c.req.url));
    const redirect = st.redirect?.startsWith("/") ? `${frontend}${st.redirect}` : st.redirect;
    return c.redirect(redirect ?? `${teamUrl(c.env, st.team, "portal")}/`);
  });

/** Adds a Discord account to a member's sign-ins. "ok", or why it wasn't. */
async function linkIdentity(
  env: Env,
  userId: string,
  discordId: string,
  email: string | null,
): Promise<"ok" | string> {
  const db = createDb(env.DB);
  const user = await db
    .select({ status: coreUsers.status })
    .from(coreUsers)
    .where(eq(coreUsers.id, userId))
    .get();
  if (!user || user.status !== "active") return "Your account is not active.";
  const existing = await db
    .select({ userId: coreUserIdentities.userId })
    .from(coreUserIdentities)
    .where(
      and(eq(coreUserIdentities.provider, "discord"), eq(coreUserIdentities.providerId, discordId)),
    )
    .get();
  if (existing) {
    return existing.userId === userId
      ? "ok"
      : "This Discord account is already linked to a different account.";
  }
  const mine = await db
    .select({ id: coreUserIdentities.id })
    .from(coreUserIdentities)
    .where(and(eq(coreUserIdentities.userId, userId), eq(coreUserIdentities.provider, "discord")))
    .get();
  if (mine) return "Your account already has a different Discord account linked.";
  const now = Math.floor(Date.now() / 1000);
  await db.insert(coreUserIdentities).values({
    id: newId(),
    userId,
    provider: "discord",
    providerId: discordId,
    providerEmail: email,
    createdAt: now,
    updatedAt: now,
  });
  return "ok";
}
