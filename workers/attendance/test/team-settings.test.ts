import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// Attendance's settings through the team's dashboard (/team-settings): the school year's start as
// "MM-DD", checked like the Attendance Settings page.

describe("Attendance's team settings", () => {
  it("read and save the school year and sign-out limit", async () => {
    const team = teamUsers(newTeamId());
    const state = await jsonAs<{ values: Record<string, unknown> }>(team.admin, "/team-settings");
    expect(state.values).toEqual({ schoolYearStart: "08-01", autoSignOutHours: 12 });
    await jsonAs(team.admin, "/team-settings", {
      method: "PUT",
      body: { values: { schoolYearStart: "09-15" } },
    });
    expect(await jsonAs(team.admin, "/admin/settings")).toEqual({
      schoolYearStartMonth: 9,
      schoolYearStartDay: 15,
      autoSignOutHours: 12,
    });
    for (const values of [{ schoolYearStart: "02-30" }, { autoSignOutHours: 30 }]) {
      const res = await callAs(team.admin, "/team-settings", { method: "PUT", body: { values } });
      expect(res.status).toBe(400);
    }
  });
});
