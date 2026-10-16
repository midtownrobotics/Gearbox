import { describe, expect, it } from "vitest";
import { cookieFrom, createUser, g3id } from "./helpers";

describe("email sign-in", () => {
  it("signs an active user in and sets a session cookie", async () => {
    await createUser({ email: "ana@test.g3", password: "correct horse" });
    const res = await g3id("/auth/login/email", {
      method: "POST",
      body: { email: "Ana@Test.G3 ", password: "correct horse" },
    });
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res);
    expect(cookie).not.toBeNull();
    expect(res.headers.get("Set-Cookie")).toMatch(/HttpOnly/i);

    const me = await g3id("/auth/me", { cookie: cookie as string });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: "ana@test.g3", sessionType: "oauth" });
  });

  it("rejects a wrong password and an unknown email the same way", async () => {
    await createUser({ email: "ben@test.g3", password: "right password" });
    const wrong = await g3id("/auth/login/email", {
      method: "POST",
      body: { email: "ben@test.g3", password: "wrong password" },
    });
    const unknown = await g3id("/auth/login/email", {
      method: "POST",
      body: { email: "nobody@test.g3", password: "whatever1" },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(cookieFrom(wrong)).toBeNull();
  });

  it("doesn't sign in accounts that aren't approved", async () => {
    await createUser({ email: "pending@test.g3", password: "password1", status: "pending" });
    await createUser({ email: "rejected@test.g3", password: "password1", status: "rejected" });
    for (const email of ["pending@test.g3", "rejected@test.g3"]) {
      const res = await g3id("/auth/login/email", {
        method: "POST",
        body: { email, password: "password1" },
      });
      expect(res.status).toBe(403);
      expect(cookieFrom(res)).toBeNull();
    }
  });

  it("requires an email and password", async () => {
    const res = await g3id("/auth/login/email", { method: "POST", body: { email: "a@b.c" } });
    expect(res.status).toBe(400);
  });
});
