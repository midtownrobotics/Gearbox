import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// Edge's settings through the team's dashboard (/team-settings): the data cap, billing day and
// blocking switches, admins only. A blocking change goes to the box like one made on Controls.

type State = {
  values: Record<string, unknown>;
  secretsSet: Record<string, boolean>;
  integrations: Record<string, { connected: boolean; detail?: string }>;
};

describe("Edge's team settings", () => {
  it("start with no cap and no box", async () => {
    const team = teamUsers(newTeamId());
    const state = await jsonAs<State>(team.admin, "/team-settings");
    expect(state.values).toEqual({
      capBytes: 0,
      cycleStartDay: 1,
      enforce: false,
      dnsHardening: false,
    });
    expect(state.secretsSet).toEqual({ boxKey: false });
    expect(state.integrations["edge box"]).toEqual({ connected: false });
  });

  it("save the cap, and a blocking change becomes a new state for the box", async () => {
    const team = teamUsers(newTeamId());
    const before = await jsonAs<{ stateVersion: number }>(team.admin, "/network/control");
    await jsonAs(team.admin, "/team-settings", {
      method: "PUT",
      body: { values: { capBytes: 50e9, cycleStartDay: 15 } },
    });
    expect(await jsonAs(team.admin, "/network/settings")).toEqual({
      capBytes: 50e9,
      cycleStartDay: 15,
    });
    expect(
      (await jsonAs<{ stateVersion: number }>(team.admin, "/network/control")).stateVersion,
    ).toBe(before.stateVersion);
    await jsonAs(team.admin, "/team-settings", {
      method: "PUT",
      body: { values: { enforce: true } },
    });
    const after = await jsonAs<{ enforce: boolean; stateVersion: number }>(
      team.admin,
      "/network/control",
    );
    expect(after).toMatchObject({ enforce: true, stateVersion: before.stateVersion + 1 });
  });

  it("can't make the box's key, and are for admins", async () => {
    const team = teamUsers(newTeamId());
    const put = (values: Record<string, unknown>) => ({ method: "PUT", body: { values } });
    expect((await callAs(team.admin, "/team-settings", put({ boxKey: "x" }))).status).toBe(400);
    expect((await callAs(team.mentor, "/team-settings", put({ enforce: true }))).status).toBe(403);
  });
});
