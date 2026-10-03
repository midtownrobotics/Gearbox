import { describe, expect, it } from "vitest";
import { createUser, g3id, sessionCookie, testEnv } from "./helpers";

describe("sessions", () => {
  it("rejects requests without a valid session", async () => {
    expect((await g3id("/auth/me")).status).toBe(401);
    expect((await g3id("/auth/me", { cookie: "g3_session=made-up" })).status).toBe(401);
  });

  it("knows the user from any of several g3_session cookies", async () => {
    const id = await createUser({ displayName: "Cara" });
    const cookie = await sessionCookie(id);
    const res = await g3id("/auth/me", { cookie: `g3_session=stale; ${cookie}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, displayName: "Cara", sessionType: "oauth" });
  });

  it("keeps sessions in KV with a 7-day lifetime and in D1", async () => {
    const id = await createUser();
    const sessionId = (await sessionCookie(id)).slice("g3_session=".length);
    expect(await testEnv.SESSIONS.get(`session:${sessionId}`)).toBe(id);
    const row = await testEnv.DB.prepare(
      "SELECT user_id, expires_at - created_at AS ttl FROM core_sessions WHERE id = ?",
    )
      .bind(sessionId)
      .first<{ user_id: string; ttl: number }>();
    expect(row).toEqual({ user_id: id, ttl: 7 * 24 * 60 * 60 });
  });

  it("ends the session on logout", async () => {
    const cookie = await sessionCookie(await createUser());
    const res = await g3id("/auth/logout", { method: "POST", cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toMatch(/g3_session=;/);
    expect((await g3id("/auth/me", { cookie })).status).toBe(401);
  });

  it("can include or leave out linked accounts", async () => {
    const cookie = await sessionCookie(await createUser({ password: "password1" }));
    const full = (await (await g3id("/auth/me", { cookie })).json()) as { identities: unknown[] };
    const lean = (await (await g3id("/auth/me?includeIdentities=false", { cookie })).json()) as {
      identities: unknown[];
    };
    expect(full.identities).toHaveLength(1);
    expect(lean.identities).toEqual([]);
  });
});
