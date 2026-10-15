import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { appPermissions, studentPermissions } from "../src/db/schema";
import { createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";
const grant = (cookie: string, user: string, app: string, permission = "manage", enabled = true) =>
  g3id(`/admin/permissions/${user}/${app}/${permission}`, {
    method: "PUT",
    cookie,
    body: { enabled },
  });
const me = async (cookie: string, app = "id") =>
  (await g3id(`/auth/me?app=${app}`, { cookie })).json();
describe("site-wide roles and additional student permissions", () => {
  it("grants and revokes a capability without changing global roles or other apps", async () => {
    const manager = await sessionCookie(await createUser({ isAdmin: true }));
    const id = await createUser();
    const cookie = await sessionCookie(id);
    expect((await grant(manager, id, "shop")).status).toBe(200);
    expect(await me(cookie, "shop")).toMatchObject({
      isAdmin: false,
      isMentor: false,
      isIdentityAdmin: false,
      permissions: ["manage"],
    });
    expect(await me(cookie, "pit")).toMatchObject({ permissions: [] });
    expect((await g3id("/admin/permissions", { cookie })).status).toBe(403);
    expect(
      (
        await g3id(`/admin/permissions/${id}/roles`, {
          cookie,
          method: "PUT",
          body: { isAdmin: true, isMentor: true },
        })
      ).status,
    ).toBe(403);
    expect((await grant(manager, id, "shop", "manage", false)).status).toBe(200);
    expect(await me(cookie, "shop")).toMatchObject({ permissions: [] });
  });
  it("keeps Admin and Mentor site wide and ignores obsolete per-app role denials", async () => {
    const id = await createUser({ isAdmin: true, isMentor: true });
    const cookie = await sessionCookie(id);
    await createDb(testEnv.DB)
      .insert(appPermissions)
      .values({
        teamId: ((await me(cookie)) as { teamId: string }).teamId,
        userId: id,
        app: "shop",
        trustedStudent: 0,
        mentorAccess: 0,
        updatedAt: 0,
      });
    for (const app of ["id", "portal", "shop", "pit", "orders"])
      expect(await me(cookie, app)).toMatchObject({
        isAdmin: true,
        isMentor: true,
        isIdentityAdmin: true,
      });
    const student = await createUser();
    expect(
      (
        await g3id(`/admin/permissions/${student}/roles`, {
          cookie,
          method: "PUT",
          body: { isAdmin: false, isMentor: true },
        })
      ).status,
    ).toBe(200);
    const mentor = await sessionCookie(student);
    for (const app of ["shop", "orders", "inventory"])
      expect(await me(mentor, app)).toMatchObject({ isAdmin: false, isMentor: true });
    expect((await g3id("/admin/permissions", { cookie: mentor })).status).toBe(403);
    expect(
      (
        await g3id(`/admin/permissions/${id}/roles`, {
          cookie,
          method: "PUT",
          body: { isAdmin: false, isMentor: false },
        })
      ).status,
    ).toBe(400);
  });
  it("gets descriptions from enabled manifests and refuses disabled or invented permissions", async () => {
    const cookie = await sessionCookie(await createUser({ isAdmin: true }));
    const id = await createUser();
    const data = (await (await g3id("/admin/permissions", { cookie })).json()) as {
      apps: { slug: string; permissions: { key: string; description: string }[] }[];
    };
    expect(data.apps.some((app) => app.slug === "edge")).toBe(false);
    expect(data.apps.find((app) => app.slug === "orders")?.permissions.map((p) => p.key)).toContain(
      "catalog",
    );
    expect(
      data.apps
        .flatMap((app) => app.permissions)
        .every((permission) => permission.description.length > 0),
    ).toBe(true);
    for (const [app, key] of [
      ["edge", "manage"],
      ["portal", "manage"],
      ["shop", "invented"],
    ])
      expect((await grant(cookie, id, app, key)).status).toBe(400);
    expect(
      (
        await g3id(`/admin/permissions/${id}/shop/manage`, {
          cookie,
          method: "PUT",
          body: { enabled: "true" },
        })
      ).status,
    ).toBe(400);
    expect((await grant(cookie, await createUser({ status: "pending" }), "shop")).status).toBe(404);
  });
  it("allows Shop channel choices but reserves Home settings and permission assignments for Admins", async () => {
    const teamId = await createTeam();
    const manager = await sessionCookie(await createUser({ teamId, isAdmin: true }));
    const id = await createUser({ teamId });
    const cookie = await sessionCookie(id);
    expect((await grant(manager, id, "shop")).status).toBe(200);
    expect((await g3id("/admin/slack/channels?app=shop", { cookie })).status).toBe(404);
    expect((await g3id("/admin/slack/channels?app=portal", { cookie })).status).toBe(403);
    expect((await g3id("/admin/users", { cookie })).status).toBe(403);
  });
  it("never gives kiosk sessions roles or delegated permissions", async () => {
    const id = await createUser({ isAdmin: true, isMentor: true });
    const cookie = await sessionCookie(id);
    await testEnv.SESSIONS.put(
      `session:${cookie.slice("g3_session=".length)}:meta`,
      JSON.stringify({ sessionType: "pin" }),
    );
    expect(await me(cookie, "shop")).toMatchObject({
      isAdmin: false,
      isMentor: false,
      isIdentityAdmin: false,
      permissions: [],
    });
    expect((await g3id("/admin/permissions", { cookie })).status).toBe(403);
  });
  it("scopes every assignment, member list and database foreign key to the manager's team", async () => {
    const a = await createTeam();
    const b = await createTeam();
    const manager = await sessionCookie(await createUser({ teamId: a, isAdmin: true }));
    const own = await createUser({ teamId: a });
    const other = await createUser({ teamId: b });
    const data = (await (await g3id("/admin/permissions", { cookie: manager })).json()) as {
      members: { id: string }[];
    };
    expect(data.members.map((m) => m.id)).toContain(own);
    expect(data.members.map((m) => m.id)).not.toContain(other);
    expect((await grant(manager, other, "shop")).status).toBe(404);
    expect(
      (await g3id("/admin/permissions", { cookie: manager, headers: { "X-Team-Id": b } })).status,
    ).toBe(403);
    await expect(
      createDb(testEnv.DB)
        .insert(studentPermissions)
        .values({ teamId: a, userId: other, app: "shop", permission: "manage", updatedAt: 0 })
        .run(),
    ).rejects.toThrow();
  });
  it("removes grants with an account or team without deleting another team's grants", async () => {
    const a = await createTeam();
    const b = await createTeam();
    const actorA = await createUser({ teamId: a, isAdmin: true });
    const actorB = await createUser({ teamId: b, isAdmin: true });
    const member = await createUser({ teamId: a });
    const ca = await sessionCookie(actorA);
    const cb = await sessionCookie(actorB);
    expect((await grant(ca, member, "shop")).status).toBe(200);
    expect((await grant(cb, actorB, "pit")).status).toBe(200);
    expect((await g3id(`/admin/users/${member}`, { cookie: ca, method: "DELETE" })).status).toBe(
      200,
    );
    expect(
      await createDb(testEnv.DB)
        .select()
        .from(studentPermissions)
        .where(eq(studentPermissions.userId, member))
        .all(),
    ).toEqual([]);
    expect((await grant(ca, actorA, "shop")).status).toBe(200);
    expect((await g3id(`/internal/teams/${a}`, { method: "DELETE" })).status).toBe(200);
    expect(
      await createDb(testEnv.DB)
        .select()
        .from(studentPermissions)
        .where(eq(studentPermissions.teamId, a))
        .all(),
    ).toEqual([]);
    expect(
      await createDb(testEnv.DB)
        .select()
        .from(studentPermissions)
        .where(and(eq(studentPermissions.teamId, b), eq(studentPermissions.userId, actorB)))
        .all(),
    ).toHaveLength(1);
  });
});
