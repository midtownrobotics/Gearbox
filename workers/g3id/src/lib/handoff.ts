import type { AppEnv } from "../types";

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
