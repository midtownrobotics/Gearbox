import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { coreUserIdentities } from "../src/db/schema";
import { newId } from "../src/lib/id";
import {
  activateKiosk,
  createTeam,
  createUser,
  createUserWithPin,
  g3id,
  sessionCookie,
  testEnv,
} from "./helpers";

// A team's admins choose which ways its members sign in (the Sign-in page of the team's admin
// pages). Slack is always on; a method that's off can't sign anyone in or be linked.

async function link(userId: string, provider: string) {
  const now = Math.floor(Date.now() / 1000);
  await createDb(testEnv.DB)
    .insert(coreUserIdentities)
    .values({ id: newId(), userId, provider, providerId: newId(), createdAt: now, updatedAt: now });
}

const all = { google: true, github: true, steam: true, pin: true };

describe("sign-in methods", () => {
  it("are all on for a team that hasn't chosen", async () => {
    const team = await createTeam();
    const res = await g3id("/team/sign-in", { headers: { "X-Team-Id": team } });
    expect(await res.json()).toEqual({ slack: true, ...all });
  });

  it("switched off, can't start a sign-in, and stay off only for that team", async () => {
    const team = await createTeam();
    const adminId = await createUser({ teamId: team, isAdmin: true });
    await link(adminId, "slack");
    const admin = await sessionCookie(adminId);
    const res = await g3id("/admin/team/sign-in", {
      method: "PUT",
      cookie: admin,
      body: { ...all, google: false },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ methods: { google: false, github: true } });

    const start = await g3id("/auth/google", {
      redirect: "manual",
      headers: { "X-Team-Id": team },
    });
    expect(start.status).toBe(302);
    expect(start.headers.get("Location")).toContain("/login/error");
    expect(start.headers.get("Location")).not.toContain("accounts.google.com");

    const other = await g3id("/auth/google", {
      redirect: "manual",
      headers: { "X-Team-Id": await createTeam() },
    });
    expect(other.headers.get("Location")).toContain("accounts.google.com");
  });

  it("with kiosk PINs off, a kiosk can't sign anyone in", async () => {
    const team = await createTeam();
    const adminId = await createUser({ teamId: team, isAdmin: true });
    await link(adminId, "slack");
    const admin = await sessionCookie(adminId);
    const kioskToken = await activateKiosk(admin);
    const { pin } = await createUserWithPin({ teamId: team });
    await g3id("/admin/team/sign-in", {
      method: "PUT",
      cookie: admin,
      body: { ...all, pin: false },
    });
    const res = await g3id("/auth/pin", { method: "POST", kioskToken, body: { pin } });
    expect(res.status).toBe(403);
  });

  it("counts who could only sign in with each, and won't lock out the admin changing them", async () => {
    const team = await createTeam();
    const adminId = await createUser({ teamId: team, isAdmin: true });
    await link(adminId, "github");
    const memberId = await createUser({ teamId: team });
    await link(memberId, "github");
    const admin = await sessionCookie(adminId);

    const state = await (await g3id("/admin/team/sign-in", { cookie: admin })).json();
    expect(state).toMatchObject({ onlyWith: { github: 2, google: 0 } });

    const res = await g3id("/admin/team/sign-in", {
      method: "PUT",
      cookie: admin,
      body: { ...all, github: false },
    });
    expect(res.status).toBe(400);
  });

  it("are changed only by admins, never from a kiosk", async () => {
    const team = await createTeam();
    const member = await sessionCookie(await createUser({ teamId: team }));
    const res = await g3id("/admin/team/sign-in", { method: "PUT", cookie: member, body: all });
    expect(res.status).toBe(403);
  });
});
