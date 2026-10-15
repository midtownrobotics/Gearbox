import { newTeamId, teamUsers, testUser } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

describe("central catalog permissions", () => {
  it("allows only site-wide Admins to assign catalog access, including before a member opens Orders", async () => {
    const team = teamUsers(newTeamId());
    const trusted = testUser({
      ...team.student,
      permissions: { orders: ["manage"] },
    });
    const path = `/trusted/${team.otherStudent.id}`;
    for (const actor of [team.student, team.mentor, trusted, team.kioskAdmin])
      expect((await callAs(actor, path, { method: "PUT", body: { trusted: true } })).status).toBe(
        403,
      );
    expect(
      (await callAs(team.admin, path, { method: "PUT", body: { trusted: true } })).status,
    ).toBe(200);
    expect(await jsonAs(team.otherStudent, "/me")).toMatchObject({
      canEditCatalog: true,
      isMentor: false,
    });
    expect(await jsonAs({ ...team.otherStudent, sessionType: "pin" }, "/me")).toMatchObject({
      canEditCatalog: false,
    });
    expect(
      (
        await callAs(team.admin, `/trusted/${teamUsers(newTeamId()).student.id}`, {
          method: "PUT",
          body: { trusted: true },
        })
      ).status,
    ).toBe(404);
    expect(
      (await callAs(team.admin, path, { method: "PUT", body: { trusted: false } })).status,
    ).toBe(200);
    expect(await jsonAs(team.otherStudent, "/me")).toMatchObject({ canEditCatalog: false });
  });
});
