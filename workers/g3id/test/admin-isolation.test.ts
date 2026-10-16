import { beforeAll, describe, expect, it } from "vitest";
import { activateKiosk, createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";

// An admin only ever sees and changes their own team's accounts and kiosks. Team A's admin calls
// every admin route against team B's records; each one must act as if B's didn't exist, and B's
// rows must come out unchanged.

type Row = Record<string, unknown>;

describe("an admin can't reach another team", () => {
  let teamA: string;
  let teamB: string;
  let adminA: string;
  let cookieB: string;
  let pendingB: string;
  let memberB: string;
  let otherB: string;
  let kioskB: number;

  // As the gateway would send it: the address's team.
  const asA = (path: string, init: Parameters<typeof g3id>[1] = {}) =>
    g3id(path, { ...init, cookie: adminA, headers: { "X-Team-Id": teamA } });

  const teamBRows = async () => ({
    users: (
      await testEnv.DB.prepare(
        "SELECT id, status, is_admin, is_mentor, deleted_at FROM core_users WHERE team_id = ? ORDER BY id",
      )
        .bind(teamB)
        .all<Row>()
    ).results,
    kiosks: (
      await testEnv.DB.prepare(
        "SELECT id, revoked_at FROM kiosk_devices WHERE team_id = ? ORDER BY id",
      )
        .bind(teamB)
        .all<Row>()
    ).results,
  });

  beforeAll(async () => {
    teamA = await createTeam();
    teamB = await createTeam();
    adminA = await sessionCookie(await createUser({ teamId: teamA, isAdmin: true }));
    const adminB = await createUser({ teamId: teamB, isAdmin: true });
    cookieB = await sessionCookie(adminB);
    pendingB = await createUser({ teamId: teamB, status: "pending", displayName: "Pending B" });
    memberB = await createUser({ teamId: teamB, displayName: "Member B" });
    otherB = await createUser({ teamId: teamB, status: "rejected", displayName: "Other B" });
    await activateKiosk(cookieB, "Kiosk B");
    const kiosk = await testEnv.DB.prepare("SELECT id FROM kiosk_devices WHERE team_id = ?")
      .bind(teamB)
      .first<{ id: number }>();
    kioskB = kiosk?.id as number;
  });

  it("lists only the admin's own team", async () => {
    const users = (await (await asA("/admin/users")).json()) as { id: string; teamId: string }[];
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => u.teamId === teamA)).toBe(true);

    const list = (await (await asA("/users")).json()) as { id: string }[];
    expect(list.map((u) => u.id)).not.toContain(memberB);

    const eligible = (await (await asA("/users/attendance-eligible")).json()) as {
      users: { id: string }[];
    };
    expect(eligible.users.map((u) => u.id)).not.toContain(memberB);

    const names = (await (await asA(`/auth/users?ids=${memberB},${pendingB}`)).json()) as unknown[];
    expect(names).toEqual([]);

    const kiosks = (await (await asA("/admin/kiosk/devices")).json()) as { id: number }[];
    expect(kiosks.map((k) => k.id)).not.toContain(kioskB);
    // Nor one of them on their own.
    expect((await asA(`/admin/users/${memberB}`)).status).toBe(404);
  });

  it("changes nothing of another team's", async () => {
    const before = await teamBRows();
    const attempts: [string, string, unknown?][] = [
      ["POST", `/admin/users/${pendingB}/approve`],
      ["POST", `/admin/users/${pendingB}/reject`],
      ["POST", `/admin/users/${memberB}/promote`],
      ["POST", `/admin/users/${memberB}/demote`],
      ["POST", `/admin/users/${memberB}/grant-mentor`],
      ["POST", `/admin/users/${memberB}/revoke-mentor`],
      ["POST", `/admin/users/${otherB}/merge`, { targetUserId: memberB }],
      ["DELETE", `/admin/users/${memberB}`],
      ["DELETE", `/admin/kiosk/devices/${kioskB}`],
    ];
    for (const [method, path, body] of attempts) {
      const res = await asA(path, { method, body });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(await teamBRows()).toEqual(before);
  });

  it("can't merge one of its own accounts into another team's", async () => {
    const mine = await createUser({ teamId: teamA, status: "rejected" });
    const res = await asA(`/admin/users/${mine}/merge`, {
      method: "POST",
      body: { targetUserId: memberB },
    });
    expect(res.status).toBe(404);
  });

  it("still works on the admin's own team", async () => {
    const pending = await createUser({ teamId: teamA, status: "pending" });
    expect((await asA(`/admin/users/${pending}/approve`, { method: "POST" })).status).toBe(200);
  });
});

describe("a member can only unlink their own sign-ins", () => {
  it("won't remove someone else's", async () => {
    const team = await createTeam();
    const me = await createUser({ teamId: team, password: "password123" });
    const them = await createUser({ teamId: team, password: "password123" });
    // Two sign-ins each, so the "keep one" rule isn't what stops it.
    for (const id of [me, them]) {
      await testEnv.DB.prepare(
        "INSERT INTO core_user_identities (id, user_id, provider, provider_id, created_at, updated_at) VALUES (?, ?, 'github', ?, 0, 0)",
      )
        .bind(crypto.randomUUID(), id, crypto.randomUUID())
        .run();
    }
    const theirs = await testEnv.DB.prepare(
      "SELECT id FROM core_user_identities WHERE user_id = ? AND provider = 'github'",
    )
      .bind(them)
      .first<{ id: string }>();

    const res = await g3id(`/auth/identities/${theirs?.id}`, {
      method: "DELETE",
      cookie: await sessionCookie(me),
      headers: { "X-Team-Id": team },
    });
    expect(res.status).toBe(404);
    const left = await testEnv.DB.prepare(
      "SELECT count(*) AS n FROM core_user_identities WHERE id = ?",
    )
      .bind(theirs?.id)
      .first<{ n: number }>();
    expect(left?.n).toBe(1);
  });
});
