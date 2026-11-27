// SPDX-License-Identifier: AGPL-3.0-only
import { and, desc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { coreUserIdentities, coreUsers, emailCodes, emailSends } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { cookieFrom, createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";

// Email and password sign-in (lib/email-sign-in.ts, routes/auth/email.ts): off until a team's
// admins switch it on, and every password goes with an address checked by an emailed code. The
// emails go to Wrangler's local Email Service; these tests set a known code on the one that was
// sent, as if they'd read it. Turnstile passes the token "pass" (vitest.config.mts).

const db = () => createDb(testEnv.DB);
const CODE = "123456";
const methodsOn = { google: true, github: true, steam: true, pin: true };

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The latest code sent to `email` for `purpose` now reads CODE. False when none was sent. */
async function knowCode(team: string, email: string, purpose: string) {
  const row = await db()
    .select({ id: emailCodes.id, codeHash: emailCodes.codeHash })
    .from(emailCodes)
    .where(
      and(
        eq(emailCodes.teamId, team),
        eq(emailCodes.email, email),
        eq(emailCodes.purpose, purpose as "signup"),
      ),
    )
    .orderBy(desc(emailCodes.createdAt))
    .get();
  if (!row?.codeHash) return false;
  await db()
    .update(emailCodes)
    .set({ codeHash: await sha256(`${row.id}:${CODE}`) })
    .where(eq(emailCodes.id, row.id));
  return true;
}

/** A team with an admin signed in through Slack, and email sign-in (and open sign-up) as asked. */
async function team({ email = true, openSignup = false } = {}) {
  const teamId = await createTeam();
  const adminId = await createUser({ teamId, isAdmin: true });
  const now = Math.floor(Date.now() / 1000);
  await db().insert(coreUserIdentities).values({
    id: newId(),
    userId: adminId,
    provider: "slack",
    providerId: newId(),
    createdAt: now,
    updatedAt: now,
  });
  const admin = await sessionCookie(adminId);
  const res = await g3id("/admin/team/sign-in", {
    method: "PUT",
    cookie: admin,
    body: { ...methodsOn, email, openSignup },
  });
  expect(res.status).toBe(200);
  return { teamId, admin };
}

const on = (teamId: string) => ({ "X-Team-Id": teamId });
const post = (path: string, teamId: string, body: unknown, cookie?: string) =>
  g3id(path, { method: "POST", headers: on(teamId), body, cookie });

/** A member of the team who joined through Slack, with a password added. */
async function memberWithPassword(teamId: string, password = "correct horse") {
  const email = `${newId()}@school.test`;
  const userId = await createUser({ teamId, email });
  const cookie = await sessionCookie(userId);
  expect((await post("/auth/password", teamId, { password }, cookie)).status).toBe(200);
  expect(await knowCode(teamId, email, "add-password")).toBe(true);
  expect((await post("/auth/password/verify", teamId, { code: CODE }, cookie)).status).toBe(200);
  return { userId, email, cookie, password };
}

describe("switching it on", () => {
  it("is off by default, and shown once an admin switches it on", async () => {
    const teamId = await createTeam();
    const off = await (await g3id("/team/sign-in", { headers: on(teamId) })).json();
    expect(off).toMatchObject({ email: false });
    const login = await post("/auth/login/email", teamId, { email: "a@b.test", password: "x" });
    expect(login.status).toBe(403);

    const { teamId: withIt, admin } = await team();
    const shown = await (await g3id("/team/sign-in", { headers: on(withIt) })).json();
    expect(shown).toMatchObject({ email: true, turnstileSiteKey: testEnv.TURNSTILE_SITE_KEY });
    const view = await (await g3id("/admin/team/sign-in", { cookie: admin })).json();
    expect(view).toMatchObject({ methods: { email: true }, emailReady: true });
  });

  it("keeps the team's choice when a page leaves it out", async () => {
    const { admin } = await team();
    const res = await g3id("/admin/team/sign-in", {
      method: "PUT",
      cookie: admin,
      body: methodsOn,
    });
    expect(await res.json()).toMatchObject({ methods: { email: true } });
  });

  it("won't lock out an admin whose only sign-in is a password", async () => {
    const { teamId } = await team();
    const adminId = await createUser({ teamId, isAdmin: true, password: "admin password" });
    const res = await g3id("/admin/team/sign-in", {
      method: "PUT",
      cookie: await sessionCookie(adminId),
      body: { ...methodsOn, email: false },
    });
    expect(res.status).toBe(400);
  });
});

describe("adding a password", () => {
  it("works once the emailed code is entered, then signs in", async () => {
    const { teamId } = await team();
    const { email, password } = await memberWithPassword(teamId);
    const login = await post("/auth/login/email", teamId, { email, password });
    expect(login.status).toBe(200);
    expect(cookieFrom(login)).toBeTruthy();
    const wrong = await post("/auth/login/email", teamId, { email, password: "not it at all" });
    expect(wrong.status).toBe(401);
  });

  it("doesn't set it until the code is right, and a code works once", async () => {
    const { teamId } = await team();
    const email = `${newId()}@school.test`;
    const cookie = await sessionCookie(await createUser({ teamId, email }));
    await post("/auth/password", teamId, { password: "a long password" }, cookie);
    await knowCode(teamId, email, "add-password");

    const wrong = await post("/auth/password/verify", teamId, { code: "000000" }, cookie);
    expect(wrong.status).toBe(400);
    expect(
      (await post("/auth/login/email", teamId, { email, password: "a long password" })).status,
    ).toBe(401);

    expect((await post("/auth/password/verify", teamId, { code: CODE }, cookie)).status).toBe(200);
    expect((await post("/auth/password/verify", teamId, { code: CODE }, cookie)).status).toBe(400);
    expect(
      (await post("/auth/password", teamId, { password: "another one!" }, cookie)).status,
    ).toBe(409);
  });

  it("stops after 5 wrong codes", async () => {
    const { teamId } = await team();
    const email = `${newId()}@school.test`;
    const cookie = await sessionCookie(await createUser({ teamId, email }));
    await post("/auth/password", teamId, { password: "a long password" }, cookie);
    await knowCode(teamId, email, "add-password");
    for (let i = 0; i < 5; i++) {
      await post("/auth/password/verify", teamId, { code: "000000" }, cookie);
    }
    const res = await post("/auth/password/verify", teamId, { code: CODE }, cookie);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Too many") });
  });

  it("needs a password long enough, and the method on", async () => {
    const { teamId } = await team();
    const cookie = await sessionCookie(await createUser({ teamId }));
    expect((await post("/auth/password", teamId, { password: "short" }, cookie)).status).toBe(400);

    const { teamId: offTeam } = await team({ email: false });
    const offCookie = await sessionCookie(await createUser({ teamId: offTeam }));
    const res = await post("/auth/password", offTeam, { password: "a long password" }, offCookie);
    expect(res.status).toBe(403);
  });

  it("sends at most 5 codes an hour to an address", async () => {
    const { teamId } = await team();
    const cookie = await sessionCookie(await createUser({ teamId }));
    for (let i = 0; i < 5; i++) {
      expect(
        (await post("/auth/password", teamId, { password: "a long password" }, cookie)).status,
      ).toBe(200);
    }
    expect(
      (await post("/auth/password", teamId, { password: "a long password" }, cookie)).status,
    ).toBe(429);
  });
});

describe("signing in", () => {
  it("only signs in the team's own members, and only goes to the team's pages", async () => {
    const { teamId } = await team();
    const { email, password } = await memberWithPassword(teamId);
    const { teamId: other } = await team();
    const elsewhere = await post("/auth/login/email", other, { email, password });
    expect(elsewhere.status).toBe(403);

    const away = await post("/auth/login/email", teamId, {
      email,
      password,
      redirect: "https://evil.test/",
    });
    expect(await away.json()).toMatchObject({ ok: true, to: null });
  });

  it("waits after 10 wrong passwords", async () => {
    const { teamId } = await team();
    const { email, password } = await memberWithPassword(teamId);
    for (let i = 0; i < 10; i++) {
      await post("/auth/login/email", teamId, { email, password: "wrong password" });
    }
    expect((await post("/auth/login/email", teamId, { email, password })).status).toBe(429);
  });
});

describe("signing up with email", () => {
  it("makes a pending account once the code is entered, which enters its name next", async () => {
    const { teamId } = await team({ openSignup: true });
    const email = `${newId()}@school.test`;
    const start = await post("/auth/signup/email", teamId, {
      email,
      password: "my new password",
      turnstile: "pass",
    });
    expect(start.status).toBe(200);
    expect(
      await db().select().from(coreUsers).where(eq(coreUsers.email, email)).get(),
    ).toBeUndefined();

    expect(await knowCode(teamId, email, "signup")).toBe(true);
    const done = await post("/auth/signup/email/verify", teamId, { email, code: CODE });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ ok: true, token: expect.any(String) });
    const user = await db().select().from(coreUsers).where(eq(coreUsers.email, email)).get();
    expect(user).toMatchObject({ teamId, status: "pending", needsName: 1, isAdmin: 0 });

    // Signing in while waiting goes back to the name step.
    const login = await post("/auth/login/email", teamId, { email, password: "my new password" });
    expect(login.status).toBe(403);
    expect(await login.json()).toMatchObject({ next: expect.stringContaining("/signup/name") });
  });

  it("needs sign-up without chat on, and the Turnstile check", async () => {
    const { teamId } = await team();
    const email = `${newId()}@school.test`;
    const body = { email, password: "my new password", turnstile: "pass" };
    expect((await post("/auth/signup/email", teamId, body)).status).toBe(403);

    const { teamId: open } = await team({ openSignup: true });
    const bot = await post("/auth/signup/email", open, { ...body, turnstile: "bot" });
    expect(bot.status).toBe(400);
  });

  it("answers the same for a taken address, which gets no code", async () => {
    const { teamId } = await team({ openSignup: true });
    const email = `${newId()}@school.test`;
    await createUser({ teamId, email });
    const res = await post("/auth/signup/email", teamId, {
      email,
      password: "my new password",
      turnstile: "pass",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(await knowCode(teamId, email, "signup")).toBe(false);
  });
});

describe("a forgotten password", () => {
  it("sends a code to a member with a password, and the new one signs in", async () => {
    const { teamId } = await team();
    const { email } = await memberWithPassword(teamId);
    const sent = await post("/auth/password/forgot", teamId, { email, turnstile: "pass" });
    expect(await sent.json()).toEqual({ sent: true });
    expect(await knowCode(teamId, email, "reset")).toBe(true);
    const reset = await post("/auth/password/reset", teamId, {
      email,
      code: CODE,
      password: "brand new password",
    });
    expect(await reset.json()).toMatchObject({ ok: true, signedIn: true });
    expect(cookieFrom(reset)).toBeTruthy();
    expect(
      (await post("/auth/login/email", teamId, { email, password: "brand new password" })).status,
    ).toBe(200);
  });

  it("answers the same for an address without one, and sends it nothing", async () => {
    const { teamId } = await team();
    const email = `${newId()}@school.test`;
    await createUser({ teamId, email });
    const res = await post("/auth/password/forgot", teamId, { email, turnstile: "pass" });
    expect(await res.json()).toEqual({ sent: true });
    expect(await knowCode(teamId, email, "reset")).toBe(false);
  });
});

describe("a team's codes and counts", () => {
  const codesOf = (teamId: string) =>
    db().select().from(emailCodes).where(eq(emailCodes.teamId, teamId)).all();
  const sendsOf = (teamId: string) =>
    db().select().from(emailSends).where(eq(emailSends.teamId, teamId)).all();

  it("move with the team, and its codes go when it's deleted; its counts stay for the limit", async () => {
    const { teamId } = await team();
    const cookie = await sessionCookie(await createUser({ teamId }));
    await post("/auth/password", teamId, { password: "a long password" }, cookie);
    const to = teamId.replace(/^frc/, "ftc");
    expect(
      (await g3id(`/internal/teams/${teamId}/move`, { method: "POST", body: { to } })).status,
    ).toBe(200);
    expect(await codesOf(teamId)).toHaveLength(0);
    expect(await sendsOf(teamId)).toHaveLength(0);
    expect(await codesOf(to)).toHaveLength(1);
    expect(await sendsOf(to)).toMatchObject([{ count: 1 }]);

    expect((await g3id(`/internal/teams/${to}`, { method: "DELETE" })).status).toBe(200);
    expect(await codesOf(to)).toHaveLength(0);
    expect(await sendsOf(to)).toMatchObject([{ count: 1 }]);
  });

  it("go with a member who's deleted", async () => {
    const { teamId, admin } = await team();
    const userId = await createUser({ teamId });
    await post(
      "/auth/password",
      teamId,
      { password: "a long password" },
      await sessionCookie(userId),
    );
    expect(await codesOf(teamId)).toHaveLength(1);
    expect((await g3id(`/admin/users/${userId}`, { method: "DELETE", cookie: admin })).status).toBe(
      200,
    );
    expect(await codesOf(teamId)).toHaveLength(0);
  });
});

describe("the sending limit", () => {
  it("counts each email, and sends none once the last 31 days reach it", async () => {
    const { teamId } = await team();
    const today = new Date().toISOString().slice(0, 10);
    const cookie = await sessionCookie(await createUser({ teamId }));
    expect(
      (await post("/auth/password", teamId, { password: "a long password" }, cookie)).status,
    ).toBe(200);
    const counted = await db()
      .select({ count: emailSends.count })
      .from(emailSends)
      .where(and(eq(emailSends.teamId, teamId), eq(emailSends.day, today)))
      .get();
    expect(counted?.count).toBe(1);

    // Another team used up the rest of the limit (EMAIL_LIMIT, 3,000 in wrangler.toml) last week.
    const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const total = await db()
      .select({ n: sql<number>`coalesce(sum(${emailSends.count}), 0)` })
      .from(emailSends)
      .get();
    const filler = `frc${Math.floor(Math.random() * 90000) + 10000}`;
    await db()
      .insert(emailSends)
      .values({ day: lastWeek, teamId: filler, kind: "signup", count: 3000 - Number(total?.n) });

    const refused = await post("/auth/password", teamId, { password: "a long password" }, cookie);
    expect(refused.status).toBe(503);
    const after = await db()
      .select({ count: emailSends.count })
      .from(emailSends)
      .where(and(eq(emailSends.teamId, teamId), eq(emailSends.day, today)))
      .get();
    expect(after?.count).toBe(1);

    const usage = await (await g3id("/internal/email/usage")).json();
    expect(usage).toMatchObject({ ready: true, limit: 3000, windowDays: 31, sent: 3000 });
    // Out of the window, it no longer counts.
    await db().update(emailSends).set({ day: "2000-01-01" }).where(eq(emailSends.teamId, filler));
    expect(
      (await post("/auth/password", teamId, { password: "a long password" }, cookie)).status,
    ).toBe(200);
  });
});
