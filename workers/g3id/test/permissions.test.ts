import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { appPermissions } from "../src/db/schema";
import { createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";

const grant = (
  cookie: string,
  user: string,
  app: string,
  trustedStudent: boolean,
  mentorAccess = false,
) =>
  g3id(`/admin/permissions/${user}/${app}`, {
    method: "PUT",
    cookie,
    body: { trustedStudent, mentorAccess },
  });
const me = async (cookie: string, app = "id") =>
  (await g3id(`/auth/me?app=${app}`, { cookie })).json();

describe("central app permissions", () => {
  it("lets app trusted students choose that app's Slack channels without granting ID access", async () => {
    const teamId = await createTeam();
    const manager = await sessionCookie(await createUser({ teamId, isAdmin: true }));
    const id = await createUser({ teamId });
    const cookie = await sessionCookie(id);
    expect((await grant(manager, id, "shop", true)).status).toBe(200);
    // This team has no Slack: 404 proves the app permission passed, without contacting Slack.
    expect((await g3id("/admin/slack/channels?app=shop", { cookie })).status).toBe(404);
    expect((await g3id("/admin/slack/channels?app=portal", { cookie })).status).toBe(403);
    expect((await g3id("/admin/users", { cookie })).status).toBe(403);
    await testEnv.SESSIONS.put(
      `session:${cookie.slice("g3_session=".length)}:meta`,
      JSON.stringify({ sessionType: "pin" }),
    );
    expect((await g3id("/admin/slack/channels?app=shop", { cookie })).status).toBe(403);
  });

  it("deletes only the departing team's permission grants", async () => {
    const teamA = await createTeam();
    const teamB = await createTeam();
    const a = await createUser({ teamId: teamA, isAdmin: true });
    const b = await createUser({ teamId: teamB, isAdmin: true });
    const cookieA = await sessionCookie(a);
    const cookieB = await sessionCookie(b);
    expect((await grant(cookieA, a, "shop", true)).status).toBe(200);
    expect((await grant(cookieB, b, "pit", true)).status).toBe(200);
    expect((await g3id(`/internal/teams/${teamA}`, { method: "DELETE" })).status).toBe(200);
    const rows = await createDb(testEnv.DB).select().from(appPermissions).all();
    expect(rows.filter((row) => row.teamId === teamA)).toEqual([]);
    expect(rows.filter((row) => row.teamId === teamB)).toHaveLength(1);
    expect((await g3id(`/internal/teams/${teamA}`, { method: "DELETE" })).status).toBe(200);
  });
  it("grants and revokes one app without granting ID or other apps", async () => {
    const manager = await sessionCookie(await createUser({ isAdmin: true }));
    const member = await createUser();
    const cookie = await sessionCookie(member);
    expect((await grant(manager, member, "shop", true)).status).toBe(200);
    expect(await me(cookie, "shop")).toMatchObject({ isAdmin: true, isIdentityAdmin: false });
    expect(await me(cookie, "pit")).toMatchObject({ isAdmin: false });
    expect(await me(cookie)).toMatchObject({ isAdmin: false });
    expect((await g3id("/admin/permissions", { cookie })).status).toBe(403);
    expect((await grant(cookie, member, "id", true)).status).toBe(403);
    expect((await grant(manager, member, "shop", false)).status).toBe(200);
    expect(await me(cookie, "shop")).toMatchObject({ isAdmin: false });
  });

  it("preserves ID roles by default and can override or restore them in one app", async () => {
    const id = await createUser({ isAdmin: true, isMentor: true });
    const cookie = await sessionCookie(id);
    expect(await me(cookie, "shop")).toMatchObject({ isAdmin: true, isMentor: true });
    expect((await grant(cookie, id, "shop", false)).status).toBe(200);
    expect(await me(cookie, "shop")).toMatchObject({
      isAdmin: false,
      isMentor: false,
      isIdentityAdmin: true,
    });
    expect(await me(cookie, "inventory")).toMatchObject({ isAdmin: true, isMentor: true });
    expect((await g3id("/admin/permissions", { cookie })).status).toBe(200);
    expect((await g3id(`/admin/permissions/${id}/shop`, { method: "DELETE", cookie })).status).toBe(
      200,
    );
    expect(await me(cookie, "shop")).toMatchObject({ isAdmin: true, isMentor: true });
    expect((await grant(cookie, id, "id", false)).status).toBe(400);
  });

  it("assigns mentor access separately and keeps ordinary mentors out of permission management", async () => {
    const manager = await sessionCookie(await createUser({ isAdmin: true }));
    const id = await createUser({ isMentor: true });
    const cookie = await sessionCookie(id);
    expect((await grant(manager, id, "inventory", false, true)).status).toBe(200);
    expect(await me(cookie, "inventory")).toMatchObject({ isAdmin: false, isMentor: true });
    expect((await g3id("/admin/permissions", { cookie })).status).toBe(403);
    expect((await grant(cookie, id, "shop", true)).status).toBe(403);
  });

  it("never exposes elevated app permissions through a kiosk PIN session", async () => {
    const id = await createUser({ isAdmin: true, isMentor: true });
    const manager = await sessionCookie(id);
    expect((await grant(manager, id, "shop", true, true)).status).toBe(200);
    const cookie = await sessionCookie(id);
    await testEnv.SESSIONS.put(
      `session:${cookie.slice("g3_session=".length)}:meta`,
      JSON.stringify({ sessionType: "pin" }),
    );
    expect(await me(cookie, "shop")).toMatchObject({
      isAdmin: false,
      isMentor: false,
      isIdentityAdmin: false,
    });
    expect((await g3id("/admin/permissions", { cookie })).status).toBe(403);
    expect((await grant(cookie, id, "pit", true)).status).toBe(403);
  });

  it("keeps the member list and every permission mutation inside the manager's team", async () => {
    const teamA = await createTeam();
    const teamB = await createTeam();
    const manager = await sessionCookie(await createUser({ teamId: teamA, isAdmin: true }));
    const own = await createUser({ teamId: teamA });
    const other = await createUser({ teamId: teamB });
    const data = (await (await g3id("/admin/permissions", { cookie: manager })).json()) as {
      members: { id: string }[];
    };
    expect(data.members.map((member) => member.id)).toContain(own);
    expect(data.members.map((member) => member.id)).not.toContain(other);
    expect((await grant(manager, other, "shop", true)).status).toBe(404);
    expect(
      (await g3id(`/admin/permissions/${other}/shop`, { cookie: manager, method: "DELETE" }))
        .status,
    ).toBe(404);
    expect(
      (await g3id("/admin/permissions", { cookie: manager, headers: { "X-Team-Id": teamB } }))
        .status,
    ).toBe(403);
    await expect(
      createDb(testEnv.DB)
        .insert(appPermissions)
        .values({
          teamId: teamA,
          userId: other,
          app: "shop",
          trustedStudent: 1,
          mentorAccess: 0,
          updatedAt: 0,
        })
        .run(),
    ).rejects.toThrow();
  });

  it("rejects invalid roles, unknown apps and inactive accounts", async () => {
    const manager = await sessionCookie(await createUser({ isAdmin: true }));
    const pending = await createUser({ status: "pending" });
    const active = await createUser();
    expect((await grant(manager, pending, "shop", true)).status).toBe(404);
    expect((await grant(manager, active, "not-an-app", true)).status).toBe(400);
    expect((await grant(manager, active, "pit", true, true)).status).toBe(400);
    expect(
      (
        await g3id(`/admin/permissions/${active}/shop`, {
          method: "PUT",
          cookie: manager,
          body: { trustedStudent: "true", mentorAccess: false },
        })
      ).status,
    ).toBe(400);
    expect((await g3id("/auth/me?app=not-an-app", { cookie: manager })).status).toBe(400);
  });

  it("deletes permission rows with an account and preserves another member's grants", async () => {
    const manager = await sessionCookie(await createUser({ isAdmin: true }));
    const deleted = await createUser();
    const retained = await createUser();
    expect((await grant(manager, deleted, "shop", true)).status).toBe(200);
    expect((await grant(manager, retained, "pit", true)).status).toBe(200);
    expect(
      (await g3id(`/admin/users/${deleted}`, { method: "DELETE", cookie: manager })).status,
    ).toBe(200);
    const db = createDb(testEnv.DB);
    expect(
      await db.select().from(appPermissions).where(eq(appPermissions.userId, deleted)).all(),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(appPermissions)
        .where(and(eq(appPermissions.userId, retained), eq(appPermissions.app, "pit")))
        .get(),
    ).toMatchObject({ trustedStudent: 1 });
  });
});
