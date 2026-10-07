import { env } from "cloudflare:test";
import { SITE_TEAM, admin, student } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { beforeEach, describe, expect, it } from "vitest";

const database = (env as unknown as { ATTENDANCE_DB: D1Database }).ATTENDANCE_DB;
const memberId = "sam_student_student-1";
const currentCode = () => Math.floor(Date.now() / 30_000);

beforeEach(async () => {
  await database.prepare("DELETE FROM attendance_members").run();
});

describe("D1 attendance workflow", () => {
  it("signs members in and out, then keeps hours in summary and leaderboard", async () => {
    const code = currentCode();
    expect((await callAs(student, "/signin", { method: "POST", body: { w: code } })).status).toBe(
      200,
    );
    expect((await callAs(student, "/signin", { method: "POST", body: { w: code } })).status).toBe(
      409,
    );
    expect(await jsonAs(student, "/status")).toEqual({ signedIn: ["Sam Student"] });

    const active = await jsonAs<{ members: { signedIn: boolean }[] }>(admin, "/admin/summary");
    expect(active.members[0].signedIn).toBe(true);

    const signout = await jsonAs<{ durationMs: number; totalHours: number }>(student, "/signout", {
      method: "POST",
      body: { w: currentCode() },
    });
    expect(signout.durationMs).toBeGreaterThanOrEqual(0);
    expect(await jsonAs(student, "/status")).toEqual({ signedIn: [] });

    const added = await jsonAs<{ totalHours: number }>(
      admin,
      `/admin/members/${memberId}/add-hours`,
      { method: "POST", body: { hours: 5 } },
    );
    expect(added.totalHours).toBeGreaterThanOrEqual(5);
    const subtracted = await jsonAs<{ totalHours: number }>(
      admin,
      `/admin/members/${memberId}/add-hours`,
      { method: "POST", body: { hours: -2 } },
    );
    expect(subtracted.totalHours).toBeGreaterThanOrEqual(3);
    expect(subtracted.totalHours).toBeLessThan(3.01);

    const summary = await jsonAs<{ members: { id: string; totalHours: number }[] }>(
      admin,
      "/admin/summary",
    );
    expect(summary.members[0].id).toBe(memberId);
    expect(summary.members[0].totalHours).toBeCloseTo(subtracted.totalHours);

    const leaderboard = await jsonAs<{
      leaderboard: { rank: number; displayName: string; totalHours: number }[];
    }>(student, "/leaderboard");
    expect(leaderboard.leaderboard[0]).toMatchObject({
      rank: 1,
      displayName: "Sam Student",
    });
    expect(leaderboard.leaderboard[0].totalHours).toBeCloseTo(subtracted.totalHours);

    expect(
      (await callAs(student, "/signout", { method: "POST", body: { w: currentCode() } })).status,
    ).toBe(404);
    expect(
      (
        await callAs(admin, `/admin/members/${memberId}/add-hours`, {
          method: "POST",
          body: { hours: 1001 },
        })
      ).status,
    ).toBe(400);
  });

  it("lets an admin sign out and delete a member with all dependent records", async () => {
    await callAs(student, "/signin", { method: "POST", body: { w: currentCode() } });
    expect(
      (await callAs(admin, `/admin/members/${memberId}/signout`, { method: "POST" })).status,
    ).toBe(200);
    expect(await jsonAs(student, "/status")).toEqual({ signedIn: [] });
    expect((await callAs(admin, `/admin/members/${memberId}`, { method: "DELETE" })).status).toBe(
      200,
    );
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM attendance_sessions")
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM attendance_totals")
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });

  it("auto-closes stale sessions and excludes their hours", async () => {
    const year = (await jsonAs<{ year: string }>(admin, "/admin/summary")).year;
    await database
      .prepare(
        "INSERT INTO attendance_members (id, team_id, user_id, display_name, email) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(memberId, SITE_TEAM, student.id, student.displayName, student.email)
      .run();
    await database
      .prepare(
        "INSERT INTO attendance_sessions (id, team_id, member_id, sign_in, status, school_year) VALUES (?, ?, ?, ?, 'open', ?)",
      )
      .bind("stale", SITE_TEAM, memberId, Date.now() - 13 * 3_600_000, year)
      .run();
    expect(await jsonAs(student, "/status")).toEqual({ signedIn: [] });
    expect(
      await database
        .prepare("SELECT status, duration_ms FROM attendance_sessions WHERE id = 'stale'")
        .first<{ status: string; duration_ms: number }>(),
    ).toEqual({ status: "auto-closed", duration_ms: 0 });
  });

  it("preserves legacy adjustments while ignoring auto-closed durations", async () => {
    const year = (await jsonAs<{ year: string }>(admin, "/admin/summary")).year;
    const now = Date.now();
    await database
      .prepare(
        "INSERT INTO attendance_members (id, team_id, user_id, display_name, email) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(memberId, SITE_TEAM, student.id, student.displayName, student.email)
      .run();
    const insert = database.prepare(
      "INSERT INTO attendance_sessions (id, team_id, member_id, sign_in, sign_out, duration_ms, status, school_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const legacy = ["legacy", SITE_TEAM, memberId, now, now, 2 * 3_600_000] as const;
    await insert.bind(...legacy, "manual-adjustment", year).run();
    const invalid = ["invalid", SITE_TEAM, memberId, now, now, 24 * 3_600_000] as const;
    await insert.bind(...invalid, "auto-closed", year).run();
    const summary = await jsonAs<{ members: { totalHours: number }[] }>(admin, "/admin/summary");
    expect(summary.members[0].totalHours).toBe(2);
    const result = await jsonAs<{ totalHours: number }>(
      admin,
      `/admin/members/${memberId}/add-hours`,
      { method: "POST", body: { hours: -100 } },
    );
    expect(result.totalHours).toBe(0);
  });
});
