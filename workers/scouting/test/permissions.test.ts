import { newTeamId, teamUsers, testUser } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

describe("central Scouting permission management", () => {
  it("keeps settings in Scouting and permission assignment restricted to ID", async () => {
    const team = teamUsers(newTeamId());
    const trusted = testUser({
      ...team.student,
      permissions: { scouting: ["manage"] },
    });
    expect(await jsonAs(trusted, "/scouting/me")).toMatchObject({
      isAdmin: true,
      isG3IdAdmin: true,
    });
    expect((await callAs(trusted, "/scouting/engagement-settings")).status).toBe(200);
    for (const path of [
      "/permission-management",
      "/strategy-admins",
      "/field-map-publisher-options",
    ]) {
      expect((await callAs(trusted, `/scouting${path}`)).status).toBe(403);
    }
    for (const path of ["/strategy-admins", "/field-map-publishers", "/service-helpers"]) {
      expect(
        (
          await callAs(trusted, `/scouting${path}`, {
            method: "POST",
            body: { userId: team.otherStudent.id, skills: [] },
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await callAs(team.admin, "/scouting/service-helpers", {
          method: "POST",
          body: { userId: team.student.id, skills: ["electrical"] },
        })
      ).status,
    ).toBe(201);
    expect(await jsonAs(team.admin, "/scouting/permission-management")).toMatchObject({
      helpers: [{ userId: team.student.id, skills: '["electrical"]' }],
    });
    expect(
      (await callAs(trusted, `/scouting/service-helpers/${team.student.id}`, { method: "DELETE" }))
        .status,
    ).toBe(403);
    expect(
      (
        await callAs(team.admin, `/scouting/service-helpers/${team.student.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(200);
  });
});
