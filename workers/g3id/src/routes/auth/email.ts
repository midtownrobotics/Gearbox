// SPDX-License-Identifier: AGPL-3.0-only
import { and, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { createDb } from "../../db";
import { coreUserIdentities, coreUsers } from "../../db/schema";
import { sessionCookieOptions } from "../../lib/cookie";
import {
  cleanEmail,
  emailSignInOn,
  passwordProblem,
  sendAccountExists,
  sendCode,
  useCode,
} from "../../lib/email-sign-in";
import { newId } from "../../lib/id";
import { openSignupOn, turnstilePassed } from "../../lib/open-signup";
import { hashPassword, verifyPassword } from "../../lib/password";
import { sanitizeRedirect } from "../../lib/redirect";
import { createSession, isPinSession } from "../../lib/session";
import { methodOff } from "../../lib/sign-in-methods";
import { nameToken } from "../../lib/signup-name";
import { requestTeamId, siteTeamId, teamOfUser } from "../../lib/team";
import { requireAuth } from "../../middleware/auth";
import type { AppEnv } from "../../types";

// Email and password sign-in (lib/email-sign-in.ts), on for a team only once its admins switch it
// on. Every password goes with an address that was checked with an emailed code: adding one to an
// account, signing up, and resetting a forgotten one.

type Ctx = Context<AppEnv>;
type Db = ReturnType<typeof createDb>;

const BOOTSTRAP_EMAIL = "admin@localhost";

async function body(c: Ctx): Promise<Record<string, unknown>> {
  return ((await c.req.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
}

/** Wrong passwords for an address: 10 in 15 minutes, then it waits. */
const LOGIN_TRIES = 10;
const LOGIN_WINDOW = 15 * 60;

async function loginKey(email: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `rate_limit:email-login:${hex}`;
}

async function loginBlocked(env: AppEnv["Bindings"], key: string): Promise<boolean> {
  const raw = await env.RATE_LIMIT.get(key);
  return raw !== null && Number(raw) >= LOGIN_TRIES;
}

async function loginFailed(env: AppEnv["Bindings"], key: string) {
  const raw = await env.RATE_LIMIT.get(key);
  await env.RATE_LIMIT.put(key, String(Number(raw ?? 0) + 1), { expirationTtl: LOGIN_WINDOW });
}

/**
 * Local development only: signing in as admin@localhost with "password" makes that admin while
 * the site has no admins, so a fresh database can be set up.
 */
async function bootstrapAdmin(db: Db) {
  const anyAdmin = await db
    .select({ id: coreUsers.id })
    .from(coreUsers)
    .where(eq(coreUsers.isAdmin, 1))
    .limit(1)
    .get();
  if (anyAdmin) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    // If the bootstrap user already exists (e.g. was demoted), just re-promote it
    const existing = await db
      .select({ id: coreUsers.id })
      .from(coreUsers)
      .where(eq(coreUsers.email, BOOTSTRAP_EMAIL))
      .get();
    if (existing) {
      await db
        .update(coreUsers)
        .set({ isAdmin: 1, status: "active", updatedAt: now })
        .where(eq(coreUsers.id, existing.id));
      return;
    }
    const userId = newId();
    await db.batch([
      db.insert(coreUsers).values({
        id: userId,
        teamId: siteTeamId,
        email: BOOTSTRAP_EMAIL,
        displayName: "Admin",
        status: "active",
        isAdmin: 1,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(coreUserIdentities).values({
        id: newId(),
        userId,
        provider: "local",
        passwordHash: await hashPassword("password"),
        createdAt: now,
        updatedAt: now,
      }),
    ]);
  } catch {
    // Race condition — another request already handled bootstrap
  }
}

/** The account with this address on the team, with its password's hash if it has one. */
async function accountOf(db: Db, teamId: string, email: string) {
  const user = await db
    .select({
      id: coreUsers.id,
      teamId: coreUsers.teamId,
      status: coreUsers.status,
      needsName: coreUsers.needsName,
    })
    .from(coreUsers)
    .where(eq(coreUsers.email, email))
    .get();
  if (!user) return null;
  const identity = await db
    .select({ id: coreUserIdentities.id, passwordHash: coreUserIdentities.passwordHash })
    .from(coreUserIdentities)
    .where(and(eq(coreUserIdentities.userId, user.id), eq(coreUserIdentities.provider, "local")))
    .get();
  return { ...user, inTeam: user.teamId === teamId, identity: identity ?? null };
}

const TURNSTILE_FAILED = "We couldn't check that you're a person. Reload the page and try again.";

/** Whether a sign-up or reset form's Turnstile token passes. */
const passed = (c: Ctx, token: unknown) =>
  turnstilePassed(
    c.env,
    typeof token === "string" ? token : undefined,
    c.req.header("CF-Connecting-IP"),
  );

export const emailAuthRouter = new Hono<AppEnv>()
  .post("/login/email", async (c) => {
    const input = await body(c);
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!email || !password) {
      return c.json({ error: "Email and password are required." }, 400);
    }

    const db = createDb(c.env.DB);
    const team = requestTeamId(c);
    const dev = c.env.ENVIRONMENT === "development";
    const bootstrap = dev && email === BOOTSTRAP_EMAIL && team === siteTeamId;
    if (bootstrap) await bootstrapAdmin(db);
    else {
      const off = await methodOff(c.env, team, "email");
      if (off) return c.json({ error: off }, 403);
    }

    const key = await loginKey(email);
    if (await loginBlocked(c.env, key)) {
      return c.json({ error: "Too many tries. Wait 15 minutes and try again." }, 429);
    }
    const invalid = { error: "Invalid email or password." };
    const account = await accountOf(db, team, email);
    const valid =
      !!account?.identity?.passwordHash &&
      (await verifyPassword(password, account.identity.passwordHash));
    if (!account || !valid) {
      await loginFailed(c.env, key);
      return c.json(invalid, 401);
    }

    // Only after the password, so this never tells anyone else whether an email has an account.
    if (!account.inTeam) {
      return c.json(
        { error: "This account belongs to another team. Sign in on your own team's page." },
        403,
      );
    }
    if (account.status === "pending") {
      // Someone who signed up and left before entering their name gets that step again.
      const token = account.needsName === 1 ? await nameToken(c.env, account.id) : null;
      return c.json(
        {
          error: "Your account is waiting for an admin's approval.",
          ...(token ? { next: `/signup/name?token=${token}&with=email` } : {}),
        },
        403,
      );
    }
    if (account.status !== "active") {
      return c.json({ error: "Your account is not active." }, 403);
    }

    const sessionId = await createSession(account.id, c.env);
    setCookie(c, "g3_session", sessionId, sessionCookieOptions(c.req.url));
    // Where the page goes next: only one of the team's own pages.
    const redirect = typeof input.redirect === "string" ? input.redirect : null;
    return c.json({ ok: true, to: sanitizeRedirect(redirect, team) });
  })

  // Adding a password to the signed-in member's account: a code goes to the account's email, and
  // the password works once it's entered (POST /password/verify).
  .post("/password", requireAuth, async (c) => {
    if (await isPinSession(getCookie(c, "g3_session"), c.env)) {
      return c.json({ error: "Add a password on your own device, not a kiosk." }, 403);
    }
    const input = await body(c);
    const problem = passwordProblem(input.password);
    if (problem) return c.json({ error: problem }, 400);

    const userId = c.get("userId") as string;
    const db = createDb(c.env.DB);
    const team = await teamOfUser(db, userId);
    const off = await methodOff(c.env, team, "email");
    if (off) return c.json({ error: off }, 403);

    const user = await db
      .select({ email: coreUsers.email })
      .from(coreUsers)
      .where(eq(coreUsers.id, userId))
      .get();
    const email = cleanEmail(user?.email);
    if (!email) {
      return c.json({ error: "Your account has no email to send a code to." }, 400);
    }
    const existing = await db
      .select({ id: coreUserIdentities.id })
      .from(coreUserIdentities)
      .where(and(eq(coreUserIdentities.userId, userId), eq(coreUserIdentities.provider, "local")))
      .get();
    if (existing) {
      return c.json({ error: "A password is already set on this account." }, 409);
    }

    const sent = await sendCode(c.env, {
      teamId: team,
      purpose: "add-password",
      email,
      userId,
      passwordHash: await hashPassword(input.password as string),
    });
    if (!sent.ok) return c.json({ error: sent.error }, sent.status);
    return c.json({ sent: true, email });
  })
  .post("/password/verify", requireAuth, async (c) => {
    const userId = c.get("userId") as string;
    const db = createDb(c.env.DB);
    const [team, user] = await Promise.all([
      teamOfUser(db, userId),
      db.select({ email: coreUsers.email }).from(coreUsers).where(eq(coreUsers.id, userId)).get(),
    ]);
    const off = await methodOff(c.env, team, "email");
    if (off) return c.json({ error: off }, 403);
    const email = cleanEmail(user?.email) ?? "";
    const checked = await useCode(c.env, {
      teamId: team,
      purpose: "add-password",
      email,
      code: (await body(c)).code,
    });
    if (!checked.ok) return c.json({ error: checked.error }, 400);
    if (checked.userId !== userId || !checked.passwordHash) {
      return c.json({ error: "That code isn't right. Check it and try again." }, 400);
    }
    const now = Math.floor(Date.now() / 1000);
    await db
      .insert(coreUserIdentities)
      .values({
        id: newId(),
        userId,
        provider: "local",
        providerEmail: email,
        passwordHash: checked.passwordHash,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
    return c.json({ ok: true });
  })

  // A forgotten password: a code goes to the address if it has a password on this team, and the
  // answer is the same either way.
  .post("/password/forgot", async (c) => {
    const team = requestTeamId(c);
    if (!(await emailSignInOn(c.env, team))) {
      return c.json({ error: "Your team doesn't use email and password to sign in." }, 403);
    }
    const input = await body(c);
    const email = cleanEmail(input.email);
    if (!email) return c.json({ error: "Enter your email." }, 400);
    if (!(await passed(c, input.turnstile))) return c.json({ error: TURNSTILE_FAILED }, 400);

    const account = await accountOf(createDb(c.env.DB), team, email);
    if (account?.inTeam && account.identity && account.status !== "rejected") {
      const sent = await sendCode(c.env, {
        teamId: team,
        purpose: "reset",
        email,
        userId: account.id,
      });
      // Only a limit says so: it's the same for an address with no account.
      if (!sent.ok && sent.status === 503) return c.json({ error: sent.error }, 503);
    }
    return c.json({ sent: true });
  })
  .post("/password/reset", async (c) => {
    const team = requestTeamId(c);
    if (!(await emailSignInOn(c.env, team))) {
      return c.json({ error: "Your team doesn't use email and password to sign in." }, 403);
    }
    const input = await body(c);
    const email = cleanEmail(input.email);
    const problem = passwordProblem(input.password);
    if (!email) return c.json({ error: "Enter your email." }, 400);
    if (problem) return c.json({ error: problem }, 400);

    const checked = await useCode(c.env, {
      teamId: team,
      purpose: "reset",
      email,
      code: input.code,
    });
    if (!checked.ok || !checked.userId) {
      return c.json({ error: checked.ok ? "That code has expired." : checked.error }, 400);
    }
    const db = createDb(c.env.DB);
    const now = Math.floor(Date.now() / 1000);
    await db
      .update(coreUserIdentities)
      .set({ passwordHash: await hashPassword(input.password as string), updatedAt: now })
      .where(
        and(
          eq(coreUserIdentities.userId, checked.userId),
          eq(coreUserIdentities.provider, "local"),
        ),
      );
    await c.env.RATE_LIMIT.delete(await loginKey(email));

    // Signed in at once when the account can be.
    const user = await db
      .select({ status: coreUsers.status })
      .from(coreUsers)
      .where(eq(coreUsers.id, checked.userId))
      .get();
    if (user?.status !== "active") return c.json({ ok: true, signedIn: false });
    const sessionId = await createSession(checked.userId, c.env);
    setCookie(c, "g3_session", sessionId, sessionCookieOptions(c.req.url));
    return c.json({ ok: true, signedIn: true });
  })

  // Signing up with an email and password, on a team that lets people sign up without chat. A
  // code goes to the address (or, when it has an account already, a note saying so, so the form
  // never tells anyone which addresses have accounts), and the account is made once it's entered.
  .post("/signup/email", async (c) => {
    const team = requestTeamId(c);
    if (!(await openSignupOn(c.env, team)) || !(await emailSignInOn(c.env, team))) {
      return c.json({ error: "Your team doesn't let people sign up with email." }, 403);
    }
    const input = await body(c);
    const email = cleanEmail(input.email);
    if (!email) return c.json({ error: "Enter a valid email." }, 400);
    const problem = passwordProblem(input.password);
    if (problem) return c.json({ error: problem }, 400);
    if (!(await passed(c, input.turnstile))) return c.json({ error: TURNSTILE_FAILED }, 400);

    const db = createDb(c.env.DB);
    const taken = await db
      .select({ teamId: coreUsers.teamId })
      .from(coreUsers)
      .where(eq(coreUsers.email, email))
      .get();
    if (taken) {
      await sendAccountExists(c.env, team, email, taken.teamId === team);
      return c.json({ sent: true });
    }
    const sent = await sendCode(c.env, {
      teamId: team,
      purpose: "signup",
      email,
      passwordHash: await hashPassword(input.password as string),
    });
    if (!sent.ok) return c.json({ error: sent.error }, sent.status);
    return c.json({ sent: true });
  })
  .post("/signup/email/verify", async (c) => {
    const team = requestTeamId(c);
    if (!(await openSignupOn(c.env, team)) || !(await emailSignInOn(c.env, team))) {
      return c.json({ error: "Your team doesn't let people sign up with email." }, 403);
    }
    const input = await body(c);
    const email = cleanEmail(input.email);
    if (!email) return c.json({ error: "Enter a valid email." }, 400);
    const checked = await useCode(c.env, {
      teamId: team,
      purpose: "signup",
      email,
      code: input.code,
    });
    if (!checked.ok) return c.json({ error: checked.error }, 400);
    if (!checked.passwordHash) {
      return c.json({ error: "That code isn't right. Check it and try again." }, 400);
    }

    const db = createDb(c.env.DB);
    const now = Math.floor(Date.now() / 1000);
    const userId = newId();
    try {
      await db.batch([
        db.insert(coreUsers).values({
          id: userId,
          teamId: team,
          email,
          // Until they enter their full name, next.
          displayName: email,
          username: null,
          needsName: 1,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        }),
        db.insert(coreUserIdentities).values({
          id: newId(),
          userId,
          provider: "local",
          providerEmail: email,
          passwordHash: checked.passwordHash,
          createdAt: now,
          updatedAt: now,
        }),
      ]);
    } catch {
      // Someone else made an account with the address since the code went out.
      return c.json({ error: "An account with this email already exists. Sign in instead." }, 409);
    }
    return c.json({ ok: true, token: await nameToken(c.env, userId) });
  })

  .get("/dev/create-user", requireAuth, async (c) => {
    if (c.env.ENVIRONMENT !== "development") {
      return c.json({ error: "Not available in this environment." }, 403);
    }

    const userId = c.get("userId") as string;
    const db = createDb(c.env.DB);

    const admin = await db
      .select({ isAdmin: coreUsers.isAdmin })
      .from(coreUsers)
      .where(eq(coreUsers.id, userId))
      .get();

    if (!admin || admin.isAdmin !== 1) {
      return c.json({ error: "Admin access required." }, 403);
    }

    const email = c.req.query("email")?.toLowerCase().trim();
    const password = c.req.query("password");
    const displayName = c.req.query("name") || email?.split("@")[0] || "Test User";

    if (!email || !password) {
      return c.json({ error: "email and password query params required" }, 400);
    }
    if (password.length < 8) {
      return c.json({ error: "Password must be at least 8 characters." }, 400);
    }

    const existing = await db
      .select({ id: coreUsers.id })
      .from(coreUsers)
      .where(eq(coreUsers.email, email))
      .get();

    if (existing) {
      return c.json({ error: "User already exists with that email." }, 409);
    }

    const now = Math.floor(Date.now() / 1000);
    const newUserId = newId();
    const passwordHash = await hashPassword(password);

    await db.batch([
      db.insert(coreUsers).values({
        id: newUserId,
        teamId: await teamOfUser(db, userId),
        email,
        displayName,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(coreUserIdentities).values({
        id: newId(),
        userId: newUserId,
        provider: "local",
        passwordHash,
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    return c.json({ ok: true, userId: newUserId, email });
  });
