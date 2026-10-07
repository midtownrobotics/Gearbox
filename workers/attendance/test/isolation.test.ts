import { env } from "cloudflare:test";
import { type Seeded, checkIsolation } from "@g3/testing/isolation";
import type { TeamUsers } from "@g3/testing/users";
import { callAs } from "@g3/testing/worker";
import { expect, it } from "vitest";
import { app } from "../src/index";

// Two teams, each with members, visits, an adjustment and its own settings. Every route, called as
// team A's admin, mentor, student and kiosk session with team B's member ids, must show none of
// B's and change nothing of B's.

const database = (env as unknown as { ATTENDANCE_DB: D1Database }).ATTENDANCE_DB;
const currentCode = () => Math.floor(Date.now() / 30_000);

async function seed(team: TeamUsers): Promise<Seeded> {
  // The member's id is made from their name and G3ID id (src/index.ts memberKey).
  for (const user of [team.student, team.otherStudent]) {
    expect(
      (await callAs(user, "/signin", { method: "POST", body: { w: currentCode() } })).status,
    ).toBe(200);
  }
  await callAs(team.otherStudent, "/signout", { method: "POST", body: { w: currentCode() } });
  const member = await database
    .prepare("SELECT id FROM attendance_members WHERE team_id = ? AND user_id = ?")
    .bind(team.teamId, team.otherStudent.id)
    .first<{ id: string }>();
  await callAs(team.admin, `/admin/members/${member?.id}/add-hours`, {
    method: "POST",
    body: { hours: 3 },
  });
  await callAs(team.admin, "/admin/settings", {
    method: "PUT",
    body: { schoolYearStartMonth: 9, schoolYearStartDay: 2, autoSignOutHours: 10 },
  });
  return {
    params: { memberId: member?.id ?? "" },
    // Member ids carry the team's G3ID user ids, which only that team's rows have.
    markers: [team.student.id, team.otherStudent.id],
  };
}

async function snapshot(teamId: string) {
  const rows = async (table: string) =>
    (
      await database
        .prepare(`SELECT * FROM ${table} WHERE team_id = ? ORDER BY 1, 2`)
        .bind(teamId)
        .all()
    ).results;
  return {
    members: await rows("attendance_members"),
    sessions: await rows("attendance_sessions"),
    totals: await rows("attendance_totals"),
    settings: await rows("attendance_settings"),
  };
}

it("keeps every team's attendance to itself", async () => {
  const { problems, requests } = await checkIsolation({
    app,
    seed,
    snapshot,
    bodies: () => ({
      "POST /admin/members/:memberId/add-hours": { hours: -100 },
      "PUT /admin/settings": {
        schoolYearStartMonth: 1,
        schoolYearStartDay: 1,
        autoSignOutHours: 1,
      },
      "POST /signin": { w: currentCode() },
      "POST /signout": { w: currentCode() },
    }),
  });
  expect(problems).toEqual([]);
  expect(requests).toBeGreaterThan(40);
});
