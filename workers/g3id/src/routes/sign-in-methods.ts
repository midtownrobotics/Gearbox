// SPDX-License-Identifier: AGPL-3.0-only
import { isDemoTeam } from "@g3/site-config";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { coreUserIdentities, coreUsers } from "../db/schema";
import { chatProvider } from "../lib/chat";
import { emailSignInReady, saveEmailSignIn } from "../lib/email-sign-in";
import { openSignupChosen, openSignupOn, saveOpenSignup, turnstileReady } from "../lib/open-signup";
import {
  METHOD_LABELS,
  OPTIONAL_METHODS,
  type OptionalMethod,
  saveSignInMethods,
  signInMethods,
} from "../lib/sign-in-methods";
import { requestTeamId, teamOfUser } from "../lib/team";
import { logToTeam } from "../lib/team-log";
import { requireAdmin } from "../middleware/auth";
import type { AppEnv } from "../types";

// The sign-in methods a team allows (lib/sign-in-methods.ts). The sign-in page and the account
// page read them for the team the address is for; the team's admins change them on the Sign-in
// page of the team's admin pages (through /api/~id).

type Db = ReturnType<typeof createDb>;

/** Slack and Discord: a team's chat is always on, so it never locks anyone out. */
const isChat = (provider: string) => provider === "slack" || provider === "discord";

type Switchable = OptionalMethod | "email";

/** A sign-in's provider as the method that switches it (a password is `local`). */
const methodOf = (provider: string) => (provider === "local" ? "email" : provider);

/** For each method that can be switched off: how many active members have only it to sign in with. */
async function onlyWith(db: Db, teamId: string): Promise<Record<Switchable, number>> {
  const rows = await db
    .select({ userId: coreUserIdentities.userId, provider: coreUserIdentities.provider })
    .from(coreUserIdentities)
    .innerJoin(coreUsers, eq(coreUsers.id, coreUserIdentities.userId))
    .where(and(eq(coreUsers.teamId, teamId), eq(coreUsers.status, "active")))
    .all();
  const byUser = new Map<string, Set<string>>();
  for (const r of rows) {
    byUser.set(r.userId, (byUser.get(r.userId) ?? new Set()).add(methodOf(r.provider)));
  }
  const counts = { google: 0, github: 0, steam: 0, pin: 0, email: 0 };
  for (const providers of byUser.values()) {
    const ways = [...providers].filter((p) => isChat(p) || p in counts);
    if (ways.length === 1 && !isChat(ways[0])) counts[ways[0] as Switchable]++;
  }
  return counts;
}

export const teamSignInRouter = new Hono<AppEnv>()
  // The team's methods, for the sign-in page (public, like its name and colors).
  .get("/", async (c) => {
    c.header("Cache-Control", "public, max-age=60");
    const team = requestTeamId(c);
    const [chosen, open] = await Promise.all([
      signInMethods(createDb(c.env.DB), team),
      openSignupOn(c.env, team),
    ]);
    // Email and password only once this site can send email too.
    const methods = { ...chosen, email: chosen.email && emailSignInReady(c.env) };
    // `openSignup`: the sign-up page offers Google, GitHub and email (those that are on), behind
    // a Turnstile check with `turnstileSiteKey`, which email's forgotten-password form uses too.
    const openSignup = open && (methods.google || methods.github || methods.email);
    return c.json({
      ...methods,
      openSignup,
      ...(openSignup || methods.email ? { turnstileSiteKey: c.env.TURNSTILE_SITE_KEY } : {}),
      // `demo`: the public demo's sign-in page offers its roles instead.
      demo: isDemoTeam(team),
    });
  });

// Which chat the team uses (Slack, Discord or none), for pages that name it ("You'll get a
// Discord DM"). Public, like its name and colors.
export const teamChatRouter = new Hono<AppEnv>().get("/", async (c) => {
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ provider: await chatProvider(c.env, requestTeamId(c)) });
});

/**
 * The Sign-in page's view: the methods, who'd be locked out, whether people can sign up without
 * chat (`openSignup`) and whether this site is set up for it (`openSignupReady`: Turnstile's keys)
 * and for email and password (`emailReady`: it sends email and has Turnstile).
 */
async function adminView(env: AppEnv["Bindings"], db: Db, team: string) {
  const [methods, only, openSignup] = await Promise.all([
    signInMethods(db, team),
    onlyWith(db, team),
    openSignupChosen(db, team),
  ]);
  return {
    methods,
    onlyWith: only,
    openSignup,
    openSignupReady: turnstileReady(env),
    emailReady: emailSignInReady(env),
  };
}

export const adminSignInRouter = new Hono<AppEnv>()
  .use("*", requireAdmin)
  .get("/", async (c) => {
    const db = createDb(c.env.DB);
    const team = await teamOfUser(db, c.get("userId") as string);
    return c.json(await adminView(c.env, db, team));
  })
  .put("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body && "openSignup" in body && typeof body.openSignup !== "boolean") {
      return c.json({ error: "Say on or off for each." }, 400);
    }
    if (body?.openSignup === true && !turnstileReady(c.env)) {
      return c.json({ error: "Signing up without chat isn't set up on this site yet." }, 400);
    }
    // Email and password is optional in the body: a page from before it keeps the team's choice.
    if (body && "email" in body && typeof body.email !== "boolean") {
      return c.json({ error: "Say on or off for each." }, 400);
    }
    const next = {} as Record<OptionalMethod, boolean>;
    for (const m of OPTIONAL_METHODS) {
      if (typeof body?.[m] !== "boolean") return c.json({ error: "Say on or off for each." }, 400);
      next[m] = body[m] as boolean;
    }
    const db = createDb(c.env.DB);
    const userId = c.get("userId") as string;
    const team = await teamOfUser(db, userId);
    const before = await signInMethods(db, team);
    const email = typeof body?.email === "boolean" ? body.email : before.email;
    if (email && !before.email && !emailSignInReady(c.env)) {
      return c.json({ error: "Email and password sign-in isn't set up on this site yet." }, 400);
    }

    // An admin who can only sign in with a method they're switching off would be locked out.
    const mine = await db
      .select({ provider: coreUserIdentities.provider })
      .from(coreUserIdentities)
      .where(
        and(
          eq(coreUserIdentities.userId, userId),
          inArray(coreUserIdentities.provider, [
            "slack",
            "discord",
            "google",
            "github",
            "steam",
            "local",
          ]),
        ),
      )
      .all();
    const chat = before.discord ? "discord" : "slack";
    const on: Record<string, boolean> = { ...next, email };
    const stillIn = mine.some((i) => i.provider === chat || on[methodOf(i.provider)] === true);
    if (mine.length > 0 && !stillIn) {
      return c.json(
        {
          error: `You couldn't sign in again. Link ${METHOD_LABELS[chat]} to your account first.`,
        },
        400,
      );
    }

    await saveSignInMethods(db, team, next, userId);
    const changed = OPTIONAL_METHODS.filter((m) => before[m] !== next[m]).map(
      (m) => `${METHOD_LABELS[m]} ${next[m] ? "on" : "off"}`,
    );
    if (email !== before.email) {
      await saveEmailSignIn(db, team, email, userId);
      changed.push(`${METHOD_LABELS.email} ${email ? "on" : "off"}`);
    }
    if (typeof body?.openSignup === "boolean") {
      const openBefore = await openSignupChosen(db, team);
      if (openBefore !== body.openSignup) {
        await saveOpenSignup(db, team, body.openSignup, userId);
        changed.push(`Sign-up without ${METHOD_LABELS[chat]} ${body.openSignup ? "on" : "off"}`);
      }
    }
    if (changed.length > 0) {
      await logToTeam(c.env, team, { userId, app: "id", what: "Sign-in methods", changed });
    }
    return c.json(await adminView(c.env, db, team));
  });
