import { teamKey } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { createTeam, createUser, createUserWithPin, g3id, sessionCookie, testEnv } from "./helpers";

// The platform's operator console (roadmap 2.8) deletes, renumbers and hands over teams through
// these internal routes, over its service binding.

const internal = (path: string, init: Parameters<typeof g3id>[1] = {}) =>
  g3id(`/internal${path}`, init);

const one = <T>(sql: string, ...binds: unknown[]) =>
  testEnv.DB.prepare(sql)
    .bind(...binds)
    .first<T>();

const freeNumber = () => 1_100_000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000);

describe("operator tools in G3ID", () => {
  it("lists a team's members", async () => {
    const team = await createTeam();
    const id = await createUser({ teamId: team, displayName: "Member", isAdmin: true });
    await createUser({ displayName: "Someone on G3" });
    const members = (await (await internal(`/teams/${team}/members`)).json()) as {
      id: string;
      isAdmin: boolean;
    }[];
    expect(members).toEqual([expect.objectContaining({ id, isAdmin: true, status: "active" })]);
  });

  it("deletes a team with its accounts, sessions and PINs", async () => {
    const team = await createTeam();
    const { id } = await createUserWithPin({ teamId: team });
    const cookie = await sessionCookie(id);
    const keep = await createUser();

    expect((await g3id("/auth/me", { cookie })).status).toBe(200);
    const res = await internal(`/teams/${team}`, { method: "DELETE" });
    expect(await res.json()).toEqual({ deletedUserIds: [id] });

    expect(await one("SELECT id FROM teams WHERE id = ?", team)).toBeNull();
    expect(await one("SELECT id FROM core_users WHERE id = ?", id)).toBeNull();
    expect(await one("SELECT id FROM core_user_pins WHERE user_id = ?", id)).toBeNull();
    expect(await one("SELECT id FROM core_sessions WHERE user_id = ?", id)).toBeNull();
    expect((await g3id("/auth/me", { cookie })).status).toBe(401);
    expect(await one("SELECT id FROM core_users WHERE id = ?", keep)).not.toBeNull();
  });

  it("won't delete or renumber the site's team", async () => {
    expect((await internal(`/teams/${teamKey}`, { method: "DELETE" })).status).toBe(409);
    const res = await internal(`/teams/${teamKey}/renumber`, {
      method: "POST",
      body: { teamNumber: freeNumber() },
    });
    expect(res.status).toBe(409);
  });

  it("renumbers a team, keeping its accounts and PINs", async () => {
    const team = await createTeam();
    const { id } = await createUserWithPin({ teamId: team });
    const cookie = await sessionCookie(id);
    const number = freeNumber();

    const res = await internal(`/teams/${team}/renumber`, {
      method: "POST",
      body: { teamNumber: number },
    });
    expect(await res.json()).toEqual({ moved: true });
    expect(await one("SELECT id FROM teams WHERE id = ?", team)).toBeNull();
    expect(await one("SELECT team_number FROM teams WHERE id = ?", `frc${number}`)).toEqual({
      team_number: number,
    });
    expect(await one("SELECT team_id FROM core_users WHERE id = ?", id)).toEqual({
      team_id: `frc${number}`,
    });
    expect(await one("SELECT team_id FROM core_user_pins WHERE user_id = ?", id)).toEqual({
      team_id: `frc${number}`,
    });
    // Still signed in.
    expect(await (await g3id("/auth/me", { cookie })).json()).toMatchObject({
      teamId: `frc${number}`,
    });
  });

  it("won't renumber onto a team it already has", async () => {
    const team = await createTeam();
    const other = await createTeam();
    const res = await internal(`/teams/${team}/renumber`, {
      method: "POST",
      body: { teamNumber: Number(other.slice(3)) },
    });
    expect(res.status).toBe(409);
  });

  it("hands a team to one of its members", async () => {
    const team = await createTeam();
    const founder = await createUser({ teamId: team, isAdmin: true });
    const next = await createUser({ teamId: team, status: "pending" });
    const outsider = await createUser();

    expect(
      (
        await internal(`/teams/${team}/owner`, {
          method: "POST",
          body: { userId: outsider },
        })
      ).status,
    ).toBe(404);

    const res = await internal(`/teams/${team}/owner`, {
      method: "POST",
      body: { userId: next, demoteUserId: founder },
    });
    expect(res.status).toBe(200);
    expect(await one("SELECT status, is_admin FROM core_users WHERE id = ?", next)).toEqual({
      status: "active",
      is_admin: 1,
    });
    expect(await one("SELECT is_admin FROM core_users WHERE id = ?", founder)).toEqual({
      is_admin: 0,
    });
  });
});
