// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { coreUserIdentities, coreUsers } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";

// Signing up without the team's chat (lib/open-signup.ts): with it on, someone new can sign up
// with Google or GitHub from the sign-up page, after a Turnstile check, and waits for approval.
// The fake Google and GitHub (vitest.config.mts) take a code "<id>:<email>"; Turnstile passes
// the token "pass".

const all = { google: true, github: true, steam: true, pin: true };

async function teamWithAdmin(openSignup: boolean) {
  const team = await createTeam();
  const adminId = await createUser({ teamId: team, isAdmin: true });
  const now = Math.floor(Date.now() / 1000);
  await createDb(testEnv.DB).insert(coreUserIdentities).values({
    id: newId(),
    userId: adminId,
    provider: "slack",
    providerId: newId(),
    createdAt: now,
    updatedAt: now,
  });
  const admin = await sessionCookie(adminId);
  if (openSignup) {
    const res = await g3id("/admin/team/sign-in", {
      method: "PUT",
      cookie: admin,
      body: { ...all, openSignup: true },
    });
    expect(res.status).toBe(200);
  }
  return { team, admin };
}

/** Starts a sign-in on the team's address and comes back from the provider with `code`. */
async function signIn(
  provider: "google" | "github",
  team: string,
  code: string,
  query = "?signup=1&turnstile=pass",
) {
  const start = await g3id(`/auth/${provider}${query}`, {
    redirect: "manual",
    headers: { "X-Team-Id": team },
  });
  const to = new URL(start.headers.get("Location") ?? "");
  const state = to.searchParams.get("state");
  if (!state) return to;
  const back = await g3id(
    `/auth/${provider}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    { redirect: "manual" },
  );
  return new URL(back.headers.get("Location") ?? "");
}

const userByEmail = (email: string) =>
  createDb(testEnv.DB).select().from(coreUsers).where(eq(coreUsers.email, email)).get();

describe("signing up without chat", () => {
  it("is off until an admin switches it on", async () => {
    const { team } = await teamWithAdmin(false);
    const methods = await g3id("/team/sign-in", { headers: { "X-Team-Id": team } });
    const body = await methods.json();
    expect(body).toMatchObject({ openSignup: false });
    expect(body).not.toHaveProperty("turnstileSiteKey");

    const email = `${newId()}@gmail.test`;
    const to = await signIn("google", team, `${newId()}:${email}`);
    expect(to.pathname).toBe("/login/error");
    expect(await userByEmail(email)).toBeUndefined();
  });

  it("makes a pending account with Google, which enters its name next", async () => {
    const { team, admin } = await teamWithAdmin(true);
    const methods = await g3id("/team/sign-in", { headers: { "X-Team-Id": team } });
    expect(await methods.json()).toMatchObject({
      openSignup: true,
      turnstileSiteKey: testEnv.TURNSTILE_SITE_KEY,
    });
    const view = await g3id("/admin/team/sign-in", { cookie: admin });
    expect(await view.json()).toMatchObject({ openSignup: true, openSignupReady: true });

    const id = newId();
    const email = `${id}@gmail.test`;
    const to = await signIn("google", team, `${id}:${email}`);
    expect(to.pathname).toBe("/signup/name");
    expect(to.searchParams.get("with")).toBe("google");
    expect(to.searchParams.get("token")).toBeTruthy();

    const user = await userByEmail(email);
    expect(user).toMatchObject({ teamId: team, status: "pending", needsName: 1, isAdmin: 0 });

    // Signing in again before entering a name brings them back to that step.
    const again = await signIn("google", team, `${id}:${email}`, "");
    expect(again.pathname).toBe("/signup/name");
  });

  it("makes a pending account with GitHub", async () => {
    const { team } = await teamWithAdmin(true);
    const id = String(Math.floor(Math.random() * 1e9));
    const email = `${id}@github.test`;
    const to = await signIn("github", team, `${id}:${email}`);
    expect(to.pathname).toBe("/signup/name");
    expect(to.searchParams.get("with")).toBe("github");
    expect(await userByEmail(email)).toMatchObject({ teamId: team, status: "pending" });
  });

  it("needs the Turnstile check to pass", async () => {
    const { team } = await teamWithAdmin(true);
    const email = `${newId()}@gmail.test`;
    const failed = await signIn("google", team, `${newId()}:${email}`, "?signup=1&turnstile=bot");
    expect(failed.pathname).toBe("/login/error");
    const missing = await signIn("google", team, `${newId()}:${email}`, "?signup=1");
    expect(missing.pathname).toBe("/login/error");
    expect(await userByEmail(email)).toBeUndefined();
  });

  it("never makes an account from the sign-in page", async () => {
    const { team } = await teamWithAdmin(true);
    const email = `${newId()}@gmail.test`;
    const to = await signIn("google", team, `${newId()}:${email}`, "");
    expect(to.pathname).toBe("/login/error");
    expect(to.searchParams.get("error")).toContain("Sign up first");
    expect(await userByEmail(email)).toBeUndefined();
  });

  it("refuses an email that's already used, or none", async () => {
    const { team } = await teamWithAdmin(true);
    const email = `${newId()}@gmail.test`;
    await createUser({ teamId: await createTeam(), email });
    const taken = await signIn("google", team, `${newId()}:${email}`);
    expect(taken.pathname).toBe("/login/error");
    expect(taken.searchParams.get("error")).toContain("already exists");

    const none = await signIn("google", team, `${newId()}:-`);
    expect(none.pathname).toBe("/login/error");
    expect(none.searchParams.get("error")).toContain("no verified email");
  });

  it("can't sign up with a method the team has off", async () => {
    const { team, admin } = await teamWithAdmin(true);
    await g3id("/admin/team/sign-in", {
      method: "PUT",
      cookie: admin,
      body: { ...all, google: false },
    });
    const email = `${newId()}@gmail.test`;
    const to = await signIn("google", team, `${newId()}:${email}`);
    expect(to.pathname).toBe("/login/error");
    expect(await userByEmail(email)).toBeUndefined();
  });

  it("is chosen per team", async () => {
    await teamWithAdmin(true);
    const { team } = await teamWithAdmin(false);
    const res = await g3id("/team/sign-in", { headers: { "X-Team-Id": team } });
    expect(await res.json()).toMatchObject({ openSignup: false });
  });

  it("keeps the setting when an admin changes another method", async () => {
    const { team, admin } = await teamWithAdmin(true);
    await g3id("/admin/team/sign-in", {
      method: "PUT",
      cookie: admin,
      body: { ...all, steam: false },
    });
    const res = await g3id("/team/sign-in", { headers: { "X-Team-Id": team } });
    expect(await res.json()).toMatchObject({ openSignup: true, steam: false });
  });
});
