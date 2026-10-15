import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// Shop's settings through the team's dashboard (/team-settings): its Slack channels and its
// quality check. The Onshape connection is only reported (it's saved on Shop's Admin page, which
// registers the webhook).

type State = {
  values: Record<string, unknown>;
  integrations: Record<string, { connected: boolean }>;
};

describe("Shop's team settings", () => {
  it("save the Slack channels, and report Onshape as not connected", async () => {
    const team = teamUsers(newTeamId());
    const state = await jsonAs<State>(team.admin, "/team-settings");
    expect(state.values).toEqual({
      slackReleaseChannelId: null,
      slackSummaryChannelId: null,
      requireQualityCheck: false,
      qualityProcessId: null,
    });
    expect(state.integrations.onshape).toMatchObject({ connected: false });
    await jsonAs(team.admin, "/team-settings", {
      method: "PUT",
      body: { values: { slackReleaseChannelId: "C0123456789" } },
    });
    expect(await jsonAs(team.admin, "/admin/slack/config")).toEqual({
      slackReleaseChannelId: "C0123456789",
      slackSummaryChannelId: "",
    });
    // Empty stops the posts.
    await jsonAs(team.admin, "/team-settings", {
      method: "PUT",
      body: { values: { slackReleaseChannelId: "" } },
    });
    expect(await jsonAs(team.admin, "/admin/slack/config")).toMatchObject({
      slackReleaseChannelId: "",
    });
  });

  it("refuse a quality check with no Quality Control process", async () => {
    const team = teamUsers(newTeamId());
    const res = await callAs(team.admin, "/team-settings", {
      method: "PUT",
      body: { values: { requireQualityCheck: true } },
    });
    expect(res.status).toBe(400);

    // The step has to be one of the team's Quality Control processes.
    const step = await jsonAs<{ id: number }>(
      team.admin,
      "/processes",
      { method: "POST", body: { name: "Final check", type: "quality_control" } },
      201,
    );
    const plain = await jsonAs<{ id: number }>(
      team.admin,
      "/processes",
      { method: "POST", body: { name: "Mill" } },
      201,
    );
    expect(
      (
        await callAs(team.admin, "/team-settings", {
          method: "PUT",
          body: { values: { requireQualityCheck: true, qualityProcessId: String(plain.id) } },
        })
      ).status,
    ).toBe(400);
    const saved = await jsonAs<{ values: Record<string, unknown> }>(team.admin, "/team-settings", {
      method: "PUT",
      body: { values: { requireQualityCheck: true, qualityProcessId: String(step.id) } },
    });
    expect(saved.values).toMatchObject({
      requireQualityCheck: true,
      qualityProcessId: String(step.id),
    });
  });

  it("refuse what isn't a channel ID, and the Onshape keys", async () => {
    const team = teamUsers(newTeamId());
    for (const values of [{ slackReleaseChannelId: "#general" }, { apiKey: "key" }]) {
      const res = await callAs(team.admin, "/team-settings", { method: "PUT", body: { values } });
      expect(res.status).toBe(400);
    }
  });
});
