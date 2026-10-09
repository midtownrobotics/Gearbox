import type { defaultTeamUiSettings } from "@g3/site-config";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { coreUserIdentities } from "../src/db/schema";
import { saveInstallation } from "../src/lib/slack-install";
import { createTeam, createUser, g3id, sessionCookie, testEnv } from "./helpers";

// The team's log (kept by the platform; stubbed in vitest.config.mts) and Slack messages to every
// admin: G3ID's own big changes, the ones other apps pass through it, and the platform's notes to
// admins when an app is switched on or off.

const logOf = async (teamId: string) =>
  (await (
    await (testEnv.PLATFORM as Fetcher).fetch(`http://platform/api/internal/teams/${teamId}/audit`)
  ).json()) as { userId: string | null; app: string; what: string; changed?: string[] }[];

async function withSlack(
  teamId: string,
  user: { isAdmin?: boolean; status?: "active" | "pending" },
) {
  const id = await createUser({ teamId, ...user });
  const now = Math.floor(Date.now() / 1000);
  await createDb(testEnv.DB)
    .insert(coreUserIdentities)
    .values({
      id: crypto.randomUUID(),
      userId: id,
      provider: "slack",
      providerId: `U${crypto.randomUUID().replace(/-/g, "").slice(0, 9).toUpperCase()}`,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

describe("the team's log", () => {
  it("records which parts of Team Appearance a save changed, and nothing for no change", async () => {
    // A team of its own: other test files change the site team's appearance too.
    const team = await createTeam();
    const admin = await createUser({ teamId: team, isAdmin: true });
    const cookie = await sessionCookie(admin);
    // Its own defaults (its number, its links), with two parts changed.
    const { defaults } = (await (await g3id("/admin/team/ui", { cookie })).json()) as {
      defaults: typeof defaultTeamUiSettings;
    };
    const settings = {
      ...defaults,
      name: "Renamed team",
      appOrder: [...defaults.appOrder].reverse(),
    };
    expect((await g3id("/admin/team/ui", { method: "PUT", cookie, body: settings })).status).toBe(
      200,
    );
    const log = await logOf(team);
    expect(log).toEqual([
      { userId: admin, app: "id", what: "Team appearance", changed: ["Name", "Apps grid order"] },
    ]);
    expect((await g3id("/admin/team/ui", { method: "PUT", cookie, body: settings })).status).toBe(
      200,
    );
    expect(await logOf(team)).toHaveLength(1);
  });

  it("passes on what other apps send it", async () => {
    const team = await createTeam();
    const change = { userId: "u1", app: "orders", what: "Orders settings", changed: ["Currency"] };
    const res = await g3id(`/internal/teams/${team}/audit`, { method: "POST", body: change });
    expect(res.status).toBe(200);
    expect(await logOf(team)).toEqual([change]);
    expect(
      (await g3id(`/internal/teams/${team}/audit`, { method: "POST", body: { app: "x" } })).status,
    ).toBe(400);
  });
});

describe("messages to every admin", () => {
  it("DMs the team's active admins who have Slack, from its own bot", async () => {
    const team = await createTeam();
    await saveInstallation(testEnv, {
      teamId: team,
      workspaceId: `T${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`,
      workspaceName: "Their Slack",
      botUserId: "UBOT",
      botToken: "xoxb-theirs",
      installedBy: null,
    });
    await withSlack(team, { isAdmin: true });
    await withSlack(team, { isAdmin: true, status: "pending" });
    await withSlack(team, {});
    await createUser({ teamId: team, isAdmin: true });
    const res = await g3id(`/internal/teams/${team}/slack/dm-admins`, {
      method: "POST",
      body: { text: "Pit was switched off." },
    });
    expect(await res.json()).toEqual({ ok: true, sent: 1, admins: 1 });
  });

  it("answers 404 for a team without Slack, so the platform knows nobody was told", async () => {
    const team = await createTeam();
    const res = await g3id(`/internal/teams/${team}/slack/dm-admins`, {
      method: "POST",
      body: { text: "Hello" },
    });
    expect(res.status).toBe(404);
  });
});
