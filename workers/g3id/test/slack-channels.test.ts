import { describe, expect, it } from "vitest";
import { saveInstallation } from "../src/lib/slack-install";
import { createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";

// The team's Slack channels, for choosing one by name (GET /admin/slack/channels). Slack is
// stubbed in vitest.config.mts.

async function teamWithSlack(botToken = "xoxb-theirs") {
  const team = await createTeam();
  await saveInstallation(testEnv, {
    teamId: team,
    workspaceId: `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
    workspaceName: "Their Slack",
    botUserId: "UBOT",
    botToken,
    installedBy: null,
  });
  return team;
}

const channelsAs = async (teamId: string, user: { isAdmin?: boolean } = { isAdmin: true }) =>
  g3id("/admin/slack/channels", {
    cookie: await sessionCookie(await createUser({ teamId, ...user })),
  });

describe("the team's Slack channels", () => {
  it("lists them by name for admins, with whether the bot is in each", async () => {
    const res = await channelsAs(await teamWithSlack());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      channels: [
        { id: "C0000000001", name: "announcements", isPrivate: false, isMember: true },
        { id: "G0000000003", name: "mentors", isPrivate: true, isMember: true },
        { id: "C0000000002", name: "shop", isPrivate: false, isMember: false },
      ],
    });
  });

  it("is for admins only", async () => {
    expect((await channelsAs(await teamWithSlack(), {})).status).toBe(403);
  });

  it("says when the team has no Slack, or has to connect it again", async () => {
    const none = await channelsAs(await createTeam());
    expect(none.status).toBe(404);
    expect(await none.json()).toMatchObject({ code: "no_slack" });
    const old = await channelsAs(await teamWithSlack("xoxb-old"));
    expect(old.status).toBe(409);
    expect(await old.json()).toMatchObject({ code: "reconnect" });
  });
});
