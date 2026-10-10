import { env } from "cloudflare:test";
import { SITE_TEAM, admin, mentor, student } from "@g3/testing/users";
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

  it("lets an admin sign everyone out at once", async () => {
    const code = currentCode();
    await callAs(student, "/signin", { method: "POST", body: { w: code } });
    await callAs(mentor, "/signin", { method: "POST", body: { w: code } });
    expect((await jsonAs<{ signedIn: string[] }>(student, "/status")).signedIn).toHaveLength(2);

    expect((await callAs(student, "/admin/signout-all", { method: "POST" })).status).toBe(403);
    expect((await jsonAs<{ signedIn: string[] }>(student, "/status")).signedIn).toHaveLength(2);

    expect(await jsonAs(admin, "/admin/signout-all", { method: "POST" })).toEqual({
      ok: true,
      signedOut: 2,
    });
    expect(await jsonAs(student, "/status")).toEqual({ signedIn: [] });
    // They're completed visits, not missed sign-outs, and doing it again signs out no one.
    expect(
      await database
        .prepare("SELECT status, COUNT(*) AS count FROM attendance_sessions GROUP BY status")
        .all<{ status: string; count: number }>()
        .then((rows) => rows.results),
    ).toEqual([{ status: "completed", count: 2 }]);
    expect(await jsonAs(admin, "/admin/signout-all", { method: "POST" })).toEqual({
      ok: true,
      signedOut: 0,
    });
  });

  it("reports each sign-in of the year with what it counted for, to any member", async () => {
    const year = (await jsonAs<{ year: string }>(admin, "/admin/summary")).year;
    const now = Date.now();
    const hour = 3_600_000;
    const mentorMemberId = "morgan_mentor_mentor-1";
    const insertMember = database.prepare(
      "INSERT INTO attendance_members (id, team_id, user_id, display_name, email) VALUES (?, ?, ?, ?, ?)",
    );
    await insertMember
      .bind(memberId, SITE_TEAM, student.id, student.displayName, student.email)
      .run();
    await insertMember
      .bind(mentorMemberId, SITE_TEAM, mentor.id, mentor.displayName, mentor.email)
      .run();
    // The student under an earlier name, and someone who is no longer a member of the team.
    await insertMember.bind("sammy_student-1", SITE_TEAM, student.id, "Sammy", "").run();
    await insertMember.bind("gone_gone-1", SITE_TEAM, "gone-1", "Gone Member", "").run();
    const insert = database.prepare(
      "INSERT INTO attendance_sessions (id, team_id, member_id, sign_in, sign_out, duration_ms, adjustment_ms, status, school_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const session = (id: string, member: string, ...rest: (number | string | null)[]) =>
      insert.bind(id, SITE_TEAM, member, ...rest).run();
    // A missed sign-out the limit closed, one still open past the limit, a visit, an adjustment,
    // someone signed in now, and a visit from an earlier school year.
    await session(
      "closed",
      memberId,
      now - 13.5 * hour,
      now - 1.5 * hour,
      0,
      null,
      "auto-closed",
      year,
    );
    await session("stale", memberId, now - 13 * hour, null, null, null, "open", year);
    await session(
      "visit",
      "sammy_student-1",
      now - 3 * hour,
      now - hour,
      2 * hour,
      null,
      "completed",
      year,
    );
    await session(
      "left",
      "gone_gone-1",
      now - 3 * hour,
      now - hour,
      2 * hour,
      null,
      "completed",
      year,
    );
    await session(
      "adjusted",
      "sammy_student-1",
      now - 2 * hour,
      now - 2 * hour,
      null,
      -0.5 * hour,
      "manual-adjustment",
      year,
    );
    await session("here", mentorMemberId, now - 0.25 * hour, null, null, null, "open", year);
    const longAgo = now - 400 * 24 * hour;
    await session("old", memberId, longAgo, longAgo + hour, hour, null, "completed", "earlier");

    const report = await jsonAs<{
      year: string;
      members: { id: string; displayName: string; isMentor: boolean }[];
      sessions: { member: number; signIn: number; kind: string; ms: number }[];
    }>(student, "/report");
    expect(report.year).toBe(year);
    // The team's active members, by name, each once under the name and role G3ID gives them.
    expect(report.members).toEqual([
      { id: mentor.id, displayName: "Morgan Mentor", isMentor: true },
      { id: student.id, displayName: "Sam Student", isMentor: false },
    ]);
    // Oldest first; the earlier year's visit and the former member's are left out.
    expect(report.sessions.map((s) => [s.member, s.kind])).toEqual([
      [1, "missed"],
      [1, "missed"],
      [1, "completed"],
      [1, "adjustment"],
      [0, "open"],
    ]);
    expect(report.sessions.slice(0, 4).map((s) => s.ms)).toEqual([0, 0, 2 * hour, -0.5 * hour]);
    expect(report.sessions[2].signIn).toBe(now - 3 * hour);
    // Someone signed in now has counted the time so far.
    expect(report.sessions[4].ms / hour).toBeCloseTo(0.25, 1);

    // The report and the leaderboard count hours the same way, for the same people.
    const { leaderboard } = await jsonAs<{
      leaderboard: { displayName: string; totalHours: number }[];
    }>(student, "/leaderboard");
    const reported = report.sessions
      .filter((s) => s.member === 1)
      .reduce((sum, s) => sum + s.ms, 0);
    expect(reported / hour).toBe(1.5);
    expect(leaderboard.map((entry) => entry.displayName).sort()).toEqual([
      "Morgan Mentor",
      "Sam Student",
    ]);
    expect(leaderboard.find((entry) => entry.displayName === "Sam Student")?.totalHours).toBe(1.5);
  });
});
