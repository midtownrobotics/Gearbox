// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { coreUsers } from "../src/db/schema";
import { nameToken } from "../src/lib/signup-name";
import { createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";

// A team's admins switch subteams on and name them; members choose theirs when they join or on
// their Account page, and admins change it on the member's page.

type Admin = { team: string; cookie: string };
type View = { enabled: boolean; subteams: { id: string; name: string; members: number }[] };

async function teamAdmin(): Promise<Admin> {
  const team = await createTeam();
  const cookie = await sessionCookie(await createUser({ teamId: team, isAdmin: true }));
  return { team, cookie };
}

async function add(admin: Admin, name: string) {
  const res = await g3id("/admin/team/subteams", {
    method: "POST",
    cookie: admin.cookie,
    body: { name },
  });
  const view = (await res.json()) as View;
  return { res, view, id: view.subteams?.find((s) => s.name === name.trim())?.id ?? "" };
}

const subteamOf = async (userId: string) =>
  (
    await createDb(testEnv.DB)
      .select({ subteamId: coreUsers.subteamId })
      .from(coreUsers)
      .where(eq(coreUsers.id, userId))
      .get()
  )?.subteamId ?? null;

describe("subteams", () => {
  it("are off for a team that hasn't chosen, and admins switch them on and name them", async () => {
    const admin = await teamAdmin();
    const first = await g3id("/admin/team/subteams", { cookie: admin.cookie });
    expect(await first.json()).toEqual({ enabled: false, subteams: [] });

    const on = await g3id("/admin/team/subteams", {
      method: "PUT",
      cookie: admin.cookie,
      body: { enabled: true },
    });
    expect(((await on.json()) as View).enabled).toBe(true);

    const { res, id } = await add(admin, "  Programming ");
    expect(res.status).toBe(201);
    expect((await add(admin, "programming")).res.status).toBe(409);

    const renamed = await g3id(`/admin/team/subteams/${id}`, {
      method: "PUT",
      cookie: admin.cookie,
      body: { name: "Software" },
    });
    expect(((await renamed.json()) as View).subteams).toEqual([
      { id, name: "Software", members: 0 },
    ]);
  });

  it("are only changed by admins, and only their own team's", async () => {
    const admin = await teamAdmin();
    const { id } = await add(admin, "Mechanical");
    const student = await sessionCookie(await createUser({ teamId: admin.team }));
    expect(
      (await g3id("/admin/team/subteams", { method: "POST", cookie: student, body: { name: "X" } }))
        .status,
    ).toBe(403);

    const other = await teamAdmin();
    const res = await g3id(`/admin/team/subteams/${id}`, {
      method: "DELETE",
      cookie: other.cookie,
    });
    expect(res.status).toBe(404);
    expect(
      ((await (await g3id("/admin/team/subteams", { cookie: admin.cookie })).json()) as View)
        .subteams,
    ).toHaveLength(1);
  });

  it("are chosen by a member on their account, and set by an admin", async () => {
    const admin = await teamAdmin();
    await g3id("/admin/team/subteams", {
      method: "PUT",
      cookie: admin.cookie,
      body: { enabled: true },
    });
    const { id } = await add(admin, "Outreach");
    const memberId = await createUser({ teamId: admin.team });
    const member = await sessionCookie(memberId);

    const mine = await g3id("/subteams/mine", {
      method: "PUT",
      cookie: member,
      body: { subteamId: id },
    });
    expect(mine.status).toBe(200);
    expect(await subteamOf(memberId)).toBe(id);
    const read = await g3id("/subteams", { cookie: member });
    expect(await read.json()).toMatchObject({ enabled: true, mine: id });

    // Another team's subteam isn't one to choose.
    const other = await teamAdmin();
    await g3id("/admin/team/subteams", {
      method: "PUT",
      cookie: other.cookie,
      body: { enabled: true },
    });
    const { id: theirs } = await add(other, "Outreach");
    const wrong = await g3id("/subteams/mine", {
      method: "PUT",
      cookie: member,
      body: { subteamId: theirs },
    });
    expect(wrong.status).toBe(400);
    expect(
      (
        await g3id(`/admin/users/${memberId}/subteam`, {
          method: "PUT",
          cookie: other.cookie,
          body: { subteamId: theirs },
        })
      ).status,
    ).toBe(404);

    const cleared = await g3id(`/admin/users/${memberId}/subteam`, {
      method: "PUT",
      cookie: admin.cookie,
      body: { subteamId: null },
    });
    expect(cleared.status).toBe(200);
    expect(await subteamOf(memberId)).toBeNull();
    const details = await g3id(`/admin/users/${memberId}`, { cookie: admin.cookie });
    expect(await details.json()).toMatchObject({ subteamId: null });

    // Deleting a subteam leaves its members in none.
    await g3id(`/admin/users/${memberId}/subteam`, {
      method: "PUT",
      cookie: admin.cookie,
      body: { subteamId: id },
    });
    await g3id(`/admin/team/subteams/${id}`, { method: "DELETE", cookie: admin.cookie });
    expect(await subteamOf(memberId)).toBeNull();
  });

  it("can't be chosen while they're off", async () => {
    const admin = await teamAdmin();
    const { id } = await add(admin, "Electrical");
    const member = await sessionCookie(await createUser({ teamId: admin.team }));
    const res = await g3id("/subteams/mine", {
      method: "PUT",
      cookie: member,
      body: { subteamId: id },
    });
    expect(res.status).toBe(400);
  });

  it("are offered when someone new joins", async () => {
    const admin = await teamAdmin();
    await g3id("/admin/team/subteams", {
      method: "PUT",
      cookie: admin.cookie,
      body: { enabled: true },
    });
    const { id } = await add(admin, "Strategy");
    const newcomer = await createUser({ teamId: admin.team, status: "pending" });
    await createDb(testEnv.DB)
      .update(coreUsers)
      .set({ needsName: 1 })
      .where(eq(coreUsers.id, newcomer));
    const token = (await nameToken(testEnv, newcomer)) ?? "";
    const headers = { "X-Team-Id": admin.team };

    const step = await g3id(`/auth/signup/name?token=${token}`, { headers });
    expect(await step.json()).toMatchObject({ subteams: [{ id, name: "Strategy" }] });
    const saved = await g3id("/auth/signup/name", {
      method: "POST",
      headers,
      body: { token, name: "Grace Hopper", subteamId: id },
    });
    expect(saved.status).toBe(200);
    expect(await subteamOf(newcomer)).toBe(id);
  });
});
