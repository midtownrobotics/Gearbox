import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// Pit's settings through the team's dashboard (/team-settings): admins only, like its Admin page.

describe("Pit's team settings", () => {
  it("save the event keys and stream for admins, and read back on the Admin page", async () => {
    const team = teamUsers(newTeamId());
    const values = { eventKey: "2026nyro", iframeUrl: "https://example.com/stream" };
    await jsonAs(team.admin, "/team-settings", { method: "PUT", body: { values } });
    expect(await jsonAs(team.admin, "/admin/settings")).toMatchObject({
      ...values,
      nexusEventKey: "",
    });
    const state = await jsonAs<{ values: Record<string, unknown>; canEdit: string[] }>(
      team.mentor,
      "/team-settings",
    );
    expect(state.values).toEqual({ ...values, nexusEventKey: null });
    expect(state.canEdit).toEqual([]);
    const res = await callAs(team.mentor, "/team-settings", {
      method: "PUT",
      body: { values: { eventKey: "2026xyz" } },
    });
    expect(res.status).toBe(403);
  });

  it("only take an https stream link", async () => {
    const team = teamUsers(newTeamId());
    const res = await callAs(team.admin, "/team-settings", {
      method: "PUT",
      body: { values: { iframeUrl: "http://example.com" } },
    });
    expect(res.status).toBe(400);
  });
});
