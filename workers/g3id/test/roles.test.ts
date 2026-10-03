import { describe, expect, it } from "vitest";
import { createUser, g3id, sessionCookie } from "./helpers";

describe("roles", () => {
  it("keeps admin routes to admins", async () => {
    const student = await sessionCookie(await createUser());
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    expect((await g3id("/admin/users")).status).toBe(401);
    expect((await g3id("/admin/users", { cookie: student })).status).toBe(403);
    expect((await g3id("/admin/users", { cookie: admin })).status).toBe(200);
  });

  it("doesn't treat a pending admin as an admin", async () => {
    const cookie = await sessionCookie(await createUser({ isAdmin: true, status: "pending" }));
    expect((await g3id("/admin/users", { cookie })).status).toBe(403);
  });

  it("reports admin and mentor on /auth/me", async () => {
    const cookie = await sessionCookie(await createUser({ isAdmin: true, isMentor: true }));
    const me = await (await g3id("/auth/me", { cookie })).json();
    expect(me).toMatchObject({ isAdmin: true, isMentor: true });
  });

  it("lets admins promote, demote and grant mentor, but not demote themselves", async () => {
    const adminId = await createUser({ isAdmin: true });
    const admin = await sessionCookie(adminId);
    const targetId = await createUser();
    const target = await sessionCookie(targetId);

    const post = (path: string) => g3id(path, { method: "POST", cookie: admin });
    expect((await post(`/admin/users/${targetId}/promote`)).status).toBe(200);
    expect(await (await g3id("/auth/me", { cookie: target })).json()).toMatchObject({
      isAdmin: true,
    });
    expect((await post(`/admin/users/${targetId}/demote`)).status).toBe(200);
    expect((await post(`/admin/users/${targetId}/grant-mentor`)).status).toBe(200);
    expect(await (await g3id("/auth/me", { cookie: target })).json()).toMatchObject({
      isAdmin: false,
      isMentor: true,
    });
    expect((await post(`/admin/users/${adminId}/demote`)).status).toBe(400);
    expect((await post("/admin/users/no-such-user/promote")).status).toBe(404);
  });

  it("approves pending users so they can sign in", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const id = await createUser({ email: "new@test.g3", password: "password1", status: "pending" });
    const approve = await g3id(`/admin/users/${id}/approve`, { method: "POST", cookie: admin });
    expect(approve.status).toBe(200);
    const login = await g3id("/auth/login/email", {
      method: "POST",
      body: { email: "new@test.g3", password: "password1" },
    });
    expect(login.status).toBe(200);
  });
});
