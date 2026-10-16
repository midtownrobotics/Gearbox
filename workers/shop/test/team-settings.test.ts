import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// Shop's settings through the team's dashboard (/team-settings): its chat channels. The Onshape
// connection is only reported (it's saved on Shop's Admin page, which registers the webhook).

type State = {
  values: Record<string, unknown>;
  integrations: Record<string, { connected: boolean }>;
};

describe("Shop's team settings", () => {
  it("save the chat channels, and report Onshape as not connected", async () => {
    const team = teamUsers(newTeamId());
    const state = await jsonAs<State>(team.admin, "/team-settings");
    expect(state.values).toEqual({ releaseChannelId: null, summaryChannelId: null });
    expect(state.integrations.onshape).toMatchObject({ connected: false });
    await jsonAs(team.admin, "/team-settings", {
      method: "PUT",
      body: { values: { releaseChannelId: "C0123456789" } },
    });
    expect(await jsonAs(team.admin, "/admin/chat/config")).toEqual({
      releaseChannelId: "C0123456789",
      summaryChannelId: "",
    });
    // Empty stops the posts.
    await jsonAs(team.admin, "/team-settings", {
      method: "PUT",
      body: { values: { releaseChannelId: "" } },
    });
    expect(await jsonAs(team.admin, "/admin/chat/config")).toMatchObject({
      releaseChannelId: "",
    });
  });

  it("refuse what isn't a channel ID, and the Onshape keys", async () => {
    const team = teamUsers(newTeamId());
    for (const values of [{ releaseChannelId: "#general" }, { apiKey: "key" }]) {
      const res = await callAs(team.admin, "/team-settings", { method: "PUT", body: { values } });
      expect(res.status).toBe(400);
    }
  });
});
