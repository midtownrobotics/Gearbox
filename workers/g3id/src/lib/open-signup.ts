// SPDX-License-Identifier: AGPL-3.0-only
import { isDemoTeam } from "@g3/site-config";
import { eq } from "drizzle-orm";
import { createDb } from "../db";
import { coreUserIdentities, coreUsers, teamSignInMethods } from "../db/schema";
import type { AppEnv } from "../types";
import { newId } from "./id";
import { nameToken } from "./signup-name";

// Signing up without the team's chat (migration 0023): a team's admins can let people sign up
// with Google or GitHub on ID's sign-up page, where they first pass a Turnstile check
// (TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY). Only a sign-in started from that page, with a
// checked token, can make an account (`signup` in lib/oauth-state.ts). Everyone who signs up this
// way waits for an admin's approval and enters their full name first (lib/signup-name.ts), like a
// chat sign-up; a team's founder always comes through chat or the platform's sign-up.

type Env = AppEnv["Bindings"];
type Db = ReturnType<typeof createDb>;

export const OPEN_SIGNUP_PROVIDERS = ["google", "github"] as const;
export type OpenSignupProvider = (typeof OPEN_SIGNUP_PROVIDERS)[number];

/** Turnstile is set up for this deployment: without its keys, nobody signs up this way. */
export const turnstileReady = (env: Env) => !!env.TURNSTILE_SITE_KEY && !!env.TURNSTILE_SECRET_KEY;

/** What the team's admins chose (off without a row), whether or not it can work now. */
export async function openSignupChosen(db: Db, teamId: string): Promise<boolean> {
  const row = await db
    .select({ openSignup: teamSignInMethods.openSignup })
    .from(teamSignInMethods)
    .where(eq(teamSignInMethods.teamId, teamId))
    .get();
  return row?.openSignup === 1;
}

/** Whether people can sign up without chat on this team now. */
export async function openSignupOn(env: Env, teamId: string): Promise<boolean> {
  if (isDemoTeam(teamId) || !turnstileReady(env)) return false;
  return openSignupChosen(createDb(env.DB), teamId);
}

export async function saveOpenSignup(db: Db, teamId: string, on: boolean, userId: string) {
  const values = {
    openSignup: on ? 1 : 0,
    updatedAt: Math.floor(Date.now() / 1000),
    updatedBy: userId,
  };
  await db
    .insert(teamSignInMethods)
    .values({ teamId, ...values })
    .onConflictDoUpdate({ target: teamSignInMethods.teamId, set: values });
}

/** Checks a Turnstile token from the sign-up page with Cloudflare. False on any failure. */
export async function turnstilePassed(
  env: Env,
  token: string | undefined,
  ip: string | undefined,
): Promise<boolean> {
  if (!token || !env.TURNSTILE_SECRET_KEY) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    if (!res.ok) return false;
    const result = (await res.json()) as { success?: boolean };
    return result.success === true;
  } catch (err) {
    console.error("[signup] Turnstile check failed", err);
    return false;
  }
}

export type OpenSignup =
  | { result: "pending"; token: string | null }
  | { result: "failed"; message: string };

/**
 * Makes a pending account for someone new who signed up with Google or GitHub, with that sign-in
 * linked. They enter their full name next (the token for /signup/name).
 */
export async function signUpWithProvider(
  env: Env,
  teamId: string,
  person: {
    provider: OpenSignupProvider;
    providerId: string;
    email: string | null;
    name: string;
    identity: { accessToken?: string; refreshToken?: string | null; tokenExpiresAt?: number };
  },
): Promise<OpenSignup> {
  const label = person.provider === "google" ? "Google" : "GitHub";
  if (!(await openSignupOn(env, teamId))) {
    return { result: "failed", message: `Your team doesn't let people sign up with ${label}.` };
  }
  if (!person.email) {
    return {
      result: "failed",
      message: `Your ${label} account has no verified email. Add one in ${label}'s settings, then try again.`,
    };
  }
  const email = person.email.toLowerCase();
  const db = createDb(env.DB);
  const existing = await db
    .select({ id: coreUsers.id })
    .from(coreUsers)
    .where(eq(coreUsers.email, email))
    .get();
  if (existing) {
    return {
      result: "failed",
      message: `An account with your email already exists. Sign in with your existing method and link ${label} from your account page.`,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const userId = newId();
  await db.batch([
    db.insert(coreUsers).values({
      id: userId,
      teamId,
      email,
      displayName: person.name.trim() || email,
      // No chat account, so no chat name.
      username: null,
      needsName: 1,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(coreUserIdentities).values({
      id: newId(),
      userId,
      provider: person.provider,
      providerId: person.providerId,
      providerEmail: email,
      accessToken: person.identity.accessToken ?? null,
      refreshToken: person.identity.refreshToken ?? null,
      tokenExpiresAt: person.identity.tokenExpiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  return { result: "pending", token: await nameToken(env, userId) };
}

/**
 * Where someone with a pending account goes after signing in with Google or GitHub: their name
 * step while they haven't entered it, else the waiting page.
 */
export async function pendingPage(
  env: Env,
  frontend: string,
  userId: string,
  provider: OpenSignupProvider,
): Promise<string> {
  const token = await nameToken(env, userId);
  return token
    ? `${frontend}/signup/name?token=${token}&with=${provider}`
    : `${frontend}/signup/pending?with=${provider}`;
}
