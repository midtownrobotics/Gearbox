// SPDX-License-Identifier: AGPL-3.0-only
import { newTeamId, teamUsers } from "@g3/testing/users";
import { call, callAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

describe("admin season tools", () => {
  const routes = [
    ["GET", "/api/team/seasons/scouting?year=2024"],
    ["GET", "/api/team/seasons/scouting/exports"],
    ["POST", "/api/team/seasons/scouting/exports"],
    ["GET", "/api/team/seasons/scouting/exports/test-id"],
    ["POST", "/api/team/seasons/scouting/exports/test-id/0/archive"],
    ["POST", "/api/team/seasons/scouting/exports/test-id/0/reset"],
    ["DELETE", "/api/team/seasons/scouting/exports/test-id"],
  ];
  it("requires a signed-in admin and rejects mentors, students and kiosk admins", async () => {
    const users = teamUsers(newTeamId());
    for (const [method, path] of routes) {
      expect((await call(path, { method })).status).toBe(401);
      for (const user of [
        users.student,
        users.mentor,
        { ...users.admin, sessionType: "pin" as const },
      ])
        expect((await callAs(user, path, { method })).status).toBe(403);
    }
  });
  it("always supplies the authenticated team, ignores caller team overrides and prevents arbitrary internal routes", async () => {
    const team = newTeamId();
    const users = teamUsers(team);
    for (const [method, path] of routes) {
      const response = await callAs(
        users.admin,
        `${path}${path.includes("?") ? "&" : "?"}teamId=another-team`,
        { method },
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await response.json()).toMatchObject({ teamId: team, method });
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    }
    expect(
      (await callAs(users.admin, "/api/team/seasons/shop/exports", { method: "POST" })).status,
    ).toBe(404);
    expect(
      (await callAs(users.admin, "/api/team/seasons/scouting/exports/test-id/0/reset")).status,
    ).toBe(404);
    expect(
      (
        await callAs(users.admin, "/api/team/seasons/scouting/internal/teams/another-team", {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
  });
});
