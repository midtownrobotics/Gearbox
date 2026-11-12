// SPDX-License-Identifier: AGPL-3.0-only
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import type { AppEnv } from "../types";
import { cookieDomain, sessionCookieOptions } from "./cookie";
import { teamFrontend } from "./team";

// A sign-in finished somewhere else (the platform's sign-up), handed to the team's own address so
// the session cookie is set on its domain: a one-time token for a session, good for 5 minutes,
// spent at /auth/handoff.

export async function createHandoff(
  env: AppEnv["Bindings"],
  teamId: string,
  sessionId: string,
): Promise<string> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await env.RATE_LIMIT.put(`handoff:${token}`, JSON.stringify({ teamId, sessionId }), {
    expirationTtl: 300,
  });
  return token;
}

/** The session a token hands over, once; null when it's unknown, spent or expired. */
export async function takeHandoff(
  env: AppEnv["Bindings"],
  token: string,
): Promise<{ teamId: string; sessionId: string } | null> {
  const key = `handoff:${token}`;
  const value = await env.RATE_LIMIT.get(key);
  if (!value) return null;
  await env.RATE_LIMIT.delete(key);
  return JSON.parse(value) as { teamId: string; sessionId: string };
}

/**
 * Ends a provider's sign-in callback: sets the session cookie and goes on to `to`. When `to` is
 * on another cookie domain than the callback (local dev, where the site team's providers call
 * back on localhost and its apps are on the dev gateway's gearbox.localhost), the cookie is set
 * on the team's own ID address instead, through /auth/handoff.
 */
export async function finishSignIn(
  c: Context<AppEnv>,
  teamId: string,
  sessionId: string,
  to: string,
): Promise<Response> {
  // A host with no cookie domain of its own (a single-label name, as in tests) keeps the cookie.
  const here = cookieDomain(c.req.url);
  if (!here || here === cookieDomain(to)) {
    setCookie(c, "g3_session", sessionId, sessionCookieOptions(c.req.url));
    return c.redirect(to);
  }
  const token = await createHandoff(c.env, teamId, sessionId);
  const params = new URLSearchParams({ token, redirect: to });
  return c.redirect(`${teamFrontend(c.env, teamId)}/api/auth/handoff?${params}`);
}
