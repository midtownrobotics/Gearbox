import { DEMO_PEOPLE, DEMO_SESSION_SECONDS, demoTeamId, visitorFor } from "@g3/demo";
import { describe, expect, it } from "vitest";
import { createTeam, createUser, g3id, sessionCookie } from "./helpers";

// The public demo (roadmap 5.1, 5.2): the platform's nightly reset makes its team's accounts, and
// a visitor picks a role instead of signing in.

const onDemo = { "X-Team-Id": demoTeamId };
const reset = () => g3id(`/internal/teams/${demoTeamId}/demo/reset`, { method: "POST" });

/** The session cookie a response set, as a request's Cookie header. */
const cookieOf = (res: Response) => res.headers.get("Set-Cookie")?.split(";")[0] ?? "";

describe("the demo team", () => {
  it("is reset to its members, every time the same", async () => {
    expect((await reset()).status).toBe(200);
    expect((await reset()).status).toBe(200);
    const pick = await g3id("/auth/demo", {
      method: "POST",
      headers: onDemo,
      body: { role: "mentor" },
    });
    const me = await g3id("/auth/me", { cookie: cookieOf(pick) });
    expect(await me.json()).toMatchObject({
      id: visitorFor("mentor").id,
      teamId: demoTeamId,
      isMentor: true,
    });
    const members = await g3id(`/internal/teams/${demoTeamId}/members`);
    expect(((await members.json()) as unknown[]).length).toBe(DEMO_PEOPLE.length);
  });

  it("has members who were last online at different times, one never", async () => {
    await reset();
    const pick = await g3id("/auth/demo", {
      method: "POST",
      headers: onDemo,
      body: { role: "admin" },
    });
    const res = await g3id("/admin/users", { cookie: cookieOf(pick), headers: onDemo });
    expect(res.status).toBe(200);
    const users = (await res.json()) as { lastSeenAt: number | null }[];
    const now = Math.floor(Date.now() / 1000);
    expect(
      users.filter((u) => u.lastSeenAt !== null && now - u.lastSeenAt < 5 * 60).length,
    ).toBeGreaterThan(1);
    expect(users.filter((u) => u.lastSeenAt === null)).toHaveLength(1);
  });

  it("signs a visitor in as the role they pick, for a few hours", async () => {
    await reset();
    for (const role of ["student", "mentor", "admin"] as const) {
      const res = await g3id("/auth/demo", { method: "POST", headers: onDemo, body: { role } });
      expect(res.status).toBe(200);
      expect(res.headers.get("Set-Cookie")).toContain(`Max-Age=${DEMO_SESSION_SECONDS}`);
      const me = await g3id("/auth/me", { cookie: cookieOf(res) });
      expect(((await me.json()) as { id: string }).id).toBe(visitorFor(role).id);
    }
    const wrong = await g3id("/auth/demo", {
      method: "POST",
      headers: onDemo,
      body: { role: "x" },
    });
    expect(wrong.status).toBe(400);
  });

  it("ends visitors' sessions when it's reset", async () => {
    await reset();
    const pick = await g3id("/auth/demo", {
      method: "POST",
      headers: onDemo,
      body: { role: "student" },
    });
    await reset();
    expect((await g3id("/auth/me", { cookie: cookieOf(pick) })).status).toBe(401);
  });

  it("offers no other way to sign in", async () => {
    await reset();
    const res = await g3id("/team/sign-in", { headers: onDemo });
    expect(await res.json()).toEqual({
      slack: false,
      discord: false,
      google: false,
      github: false,
      steam: false,
      pin: false,
      demo: true,
    });
  });

  it("works only for the demo team", async () => {
    const team = await createTeam();
    const res = await g3id("/auth/demo", {
      method: "POST",
      headers: { "X-Team-Id": team },
      body: { role: "admin" },
    });
    expect(res.status).toBe(404);
    expect((await g3id(`/internal/teams/${team}/demo/reset`, { method: "POST" })).status).toBe(403);
    // Another team's people are untouched by a reset.
    const member = await createUser({ teamId: team });
    await reset();
    expect((await g3id("/auth/me", { cookie: await sessionCookie(member) })).status).toBe(200);
  });
});
