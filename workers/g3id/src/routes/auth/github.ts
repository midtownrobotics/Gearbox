import { resolveUserId } from "@g3/auth";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createDb } from "../../db";
import { coreUserIdentities, coreUsers } from "../../db/schema";
import { sessionCookieOptions } from "../../lib/cookie";
import { newId } from "../../lib/id";
import { decodeState, encodeState } from "../../lib/oauth-state";
import { sanitizeRedirect } from "../../lib/redirect";
import { createSession } from "../../lib/session";
import { providerRedirectUri, requestTeamId, teamFrontend, teamOfUser } from "../../lib/team";
import type { AppEnv } from "../../types";

function buildGithubUrl(env: AppEnv["Bindings"], state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

async function generateState(env: AppEnv["Bindings"], value: string): Promise<string> {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const payload = JSON.stringify({ value, expiresAt: Date.now() + 10 * 60 * 1000, nonce });
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(payload));
  const signature = await signState(env.GITHUB_CLIENT_SECRET, encodedPayload);
  return `${encodedPayload}.${bytesToBase64Url(signature)}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function stateKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signState(secret: string, payload: string): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await stateKey(secret),
    new TextEncoder().encode(payload),
  );
  return new Uint8Array(signature);
}

async function verifyState(env: AppEnv["Bindings"], state: string): Promise<string | null> {
  const parts = state.split(".");
  if (parts.length !== 2) return null;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await stateKey(env.GITHUB_CLIENT_SECRET),
      base64UrlToBytes(parts[1]),
      new TextEncoder().encode(parts[0]),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0]))) as {
      value?: unknown;
      expiresAt?: unknown;
      nonce?: unknown;
    };
    if (
      typeof payload.value !== "string" ||
      typeof payload.expiresAt !== "number" ||
      typeof payload.nonce !== "string" ||
      payload.expiresAt < Date.now()
    ) {
      return null;
    }
    return payload.value;
  } catch {
    return null;
  }
}

async function getGithubUser(
  accessToken: string,
): Promise<{ id: string; login: string; email: string | null; name: string }> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "g3id-worker",
  };

  const userRes = await fetch("https://api.github.com/user", { headers });
  if (!userRes.ok) throw new Error("Failed to fetch GitHub user.");
  const user = (await userRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
  };

  let email = user.email;

  // Email is null if the user has set it to private — fetch from the emails endpoint
  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as {
        email: string;
        primary: boolean;
        verified: boolean;
      }[];
      email = emails.find((e) => e.primary && e.verified)?.email ?? null;
    }
  }

  return {
    id: String(user.id),
    login: user.login,
    email,
    name: user.name ?? user.login,
  };
}

export const githubAuthRouter = new Hono<AppEnv>()
  // Sign-in initiation
  .get("/github", async (c) => {
    const team = requestTeamId(c);
    const redirect = sanitizeRedirect(c.req.query("redirect"), team);
    const state = await generateState(c.env, encodeState({ team, redirect, linkUserId: null }));
    return c.redirect(buildGithubUrl(c.env, state, providerRedirectUri(c.env, "github", team)));
  })
  // Link initiation — user must already be signed in
  .get("/github/link", async (c) => {
    const app = (path: string) => `${c.env.FRONTEND_URL}${path}`;
    const userId = await resolveUserId(c.req.header("Cookie") ?? "", c.env);
    if (!userId) return c.redirect(app("/login"));

    const team = await teamOfUser(createDb(c.env.DB), userId);
    const state = await generateState(
      c.env,
      encodeState({ team, redirect: null, linkUserId: userId }),
    );
    return c.redirect(buildGithubUrl(c.env, state, providerRedirectUri(c.env, "github", team)));
  })
  // Shared callback
  .get("/github/callback", async (c) => {
    // Until the state says which team this is, errors go to the site team's page.
    let frontend = c.env.FRONTEND_URL;
    const app = (path: string) => `${frontend}${path}`;
    const oauthError = c.req.query("error");
    const code = c.req.query("code");
    const state = c.req.query("state");

    const err = (msg: string) => c.redirect(app(`/login/error?error=${encodeURIComponent(msg)}`));

    if (oauthError) return err("Sign-in was canceled or denied.");
    if (!code || !state) return err("Missing code or state.");

    const stateValue = await verifyState(c.env, state);
    if (!stateValue) return err("This sign-in link has expired. Please try again.");

    const st = decodeState(stateValue);
    frontend = teamFrontend(c.env, st.team);
    const linkUserId = st.linkUserId;
    const isLink = linkUserId !== null;
    const redirectTo = st.redirect?.startsWith("/") ? app(st.redirect) : st.redirect;

    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: providerRedirectUri(c.env, "github", st.team),
      }),
    });

    const tokenBodyText = await tokenRes.text();

    if (!tokenRes.ok) {
      console.error("[github oauth] token exchange failed", tokenRes.status, tokenBodyText);
      if (tokenRes.status === 429) {
        return err("GitHub is temporarily busy. Please wait a few minutes and try again.");
      }
      return err("Failed to complete sign-in with GitHub. Please try again.");
    }

    let accessToken: string | undefined;
    try {
      ({ access_token: accessToken } = JSON.parse(tokenBodyText) as { access_token?: string });
    } catch {
      console.error("[github oauth] token response was not valid JSON", tokenBodyText);
      return err("Failed to complete sign-in with GitHub. Please try again.");
    }

    if (!accessToken) {
      // GitHub returns HTTP 200 with an error body (e.g. redirect_uri_mismatch,
      // bad_verification_code, incorrect_client_credentials) instead of a 4xx.
      console.error("[github oauth] no access_token in response", tokenBodyText);
      return err("Failed to complete sign-in with GitHub. Please try again.");
    }

    let githubUser: { id: string; login: string; email: string | null; name: string };
    try {
      githubUser = await getGithubUser(accessToken);
    } catch {
      return err("Failed to fetch your GitHub profile. Please try again.");
    }

    const sub = githubUser.id;

    const db = createDb(c.env.DB);
    const now = Math.floor(Date.now() / 1000);

    const identityValues = {
      id: newId(),
      provider: "github" as const,
      providerId: sub,
      providerEmail: githubUser.email,
      accessToken,
      createdAt: now,
      updatedAt: now,
    };

    // --- Link flow ---
    if (isLink && linkUserId) {
      const currentUserId = await resolveUserId(c.req.header("Cookie") ?? "", c.env);
      if (currentUserId !== linkUserId) {
        return err("Your sign-in session expired. Sign in again before linking GitHub.");
      }

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
          and(eq(coreUserIdentities.provider, "github"), eq(coreUserIdentities.providerId, sub)),
        )
        .get();

      if (existingIdentity) {
        if (existingIdentity.userId === linkUserId) return c.redirect(app("/dashboard"));
        return err("This GitHub account is already linked to a different account.");
      }

      await db.insert(coreUserIdentities).values({ ...identityValues, userId: linkUserId });
      return c.redirect(app("/dashboard"));
    }

    // --- Sign-in flow ---
    const identity = await db
      .select({ userId: coreUserIdentities.userId })
      .from(coreUserIdentities)
      .where(and(eq(coreUserIdentities.provider, "github"), eq(coreUserIdentities.providerId, sub)))
      .get();

    if (identity) {
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
      setCookie(c, "g3_session", sessionId, sessionCookieOptions(c.req.url));
      return c.redirect(redirectTo ?? app("/dashboard"));
    }

    // No GitHub identity found — account must already exist
    return err(
      "No linked account found. Sign in with an existing method, then link GitHub from your dashboard.",
    );
  });
