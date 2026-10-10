import { env } from "cloudflare:test";
import { admin, newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// Each team's attendance settings: when its school year starts and how long a session may stay
// open. Edited by the team's admins on G3ID's Attendance admin page.

const database = (env as unknown as { ATTENDANCE_DB: D1Database }).ATTENDANCE_DB;
const currentCode = () => Math.floor(Date.now() / 30_000);

describe("attendance settings", () => {
  it("keeps the site team's from before (3 August, 12 hours), and gives a new team the defaults", async () => {
    expect(await jsonAs(admin, "/admin/settings")).toEqual({
      schoolYearStartMonth: 8,
      schoolYearStartDay: 3,
      autoSignOutHours: 12,
    });
    const other = teamUsers(newTeamId());
    expect(await jsonAs(other.admin, "/admin/settings")).toEqual({
      schoolYearStartMonth: 8,
      schoolYearStartDay: 1,
      autoSignOutHours: 12,
    });
  });

  it("lets only admins change them, never from a kiosk", async () => {
    const team = teamUsers(newTeamId());
    const body = { schoolYearStartMonth: 9, schoolYearStartDay: 1, autoSignOutHours: 6 };
    for (const user of [team.mentor, team.student, team.kioskAdmin]) {
      expect((await callAs(user, "/admin/settings", { method: "PUT", body })).status).toBe(403);
    }
    expect((await callAs(team.admin, "/admin/settings", { method: "PUT", body })).status).toBe(200);
    expect(await jsonAs(team.admin, "/admin/settings")).toEqual(body);
    // Another team's are untouched.
    expect(await jsonAs(admin, "/admin/settings")).toMatchObject({ schoolYearStartDay: 3 });
  });

  it("refuses dates and limits that don't make sense", async () => {
    const team = teamUsers(newTeamId());
    for (const body of [
      { schoolYearStartMonth: 13, schoolYearStartDay: 1, autoSignOutHours: 12 },
      { schoolYearStartMonth: 2, schoolYearStartDay: 30, autoSignOutHours: 12 },
      { schoolYearStartMonth: 8, schoolYearStartDay: 1, autoSignOutHours: 0 },
      { schoolYearStartMonth: 8, schoolYearStartDay: 1, autoSignOutHours: 25 },
      { schoolYearStartMonth: "8", schoolYearStartDay: 1, autoSignOutHours: 12 },
    ]) {
      expect((await callAs(team.admin, "/admin/settings", { method: "PUT", body })).status).toBe(
        400,
      );
    }
  });

  it("closes a session by the team's own limit", async () => {
    const team = teamUsers(newTeamId());
    await callAs(team.admin, "/admin/settings", {
      method: "PUT",
      body: { schoolYearStartMonth: 8, schoolYearStartDay: 1, autoSignOutHours: 2 },
    });
    expect(
      (await callAs(team.student, "/signin", { method: "POST", body: { w: currentCode() } }))
        .status,
    ).toBe(200);
    // Signed in three hours ago: past this team's two-hour limit, though under the default 12.
    await database
      .prepare("UPDATE attendance_sessions SET sign_in = ? WHERE team_id = ? AND status = 'open'")
      .bind(Date.now() - 3 * 3_600_000, team.teamId)
      .run();
    expect(await jsonAs(team.student, "/status")).toEqual({ signedIn: [] });
    const closed = await database
      .prepare("SELECT status FROM attendance_sessions WHERE team_id = ?")
      .bind(team.teamId)
      .first<{ status: string }>();
    expect(closed?.status).toBe("auto-closed");
  });
});
