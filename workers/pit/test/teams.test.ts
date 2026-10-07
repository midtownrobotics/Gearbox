import { env } from "cloudflare:test";
import { type Seeded, checkIsolation } from "@g3/testing/isolation";
import { type TeamUsers, newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";

// Pit for many teams: each team's checklists, batteries and settings are its own, its team number
// is its own, and the Blue Alliance and Nexus API keys are the platform's, never a team setting.

const database = (env as unknown as { PIT_DB: D1Database }).PIT_DB;

describe("settings per team", () => {
  it("keeps each team's event keys, says its own team number, and holds no API keys", async () => {
    const [a, b] = [teamUsers(newTeamId()), teamUsers(newTeamId())];
    await callAs(a.admin, "/admin/settings", {
      method: "PATCH",
      body: { eventKey: "2026aaa", tbaAuthKey: "not-a-setting", nexusApiKey: "nor-this" },
    });
    await callAs(b.admin, "/admin/settings", { method: "PATCH", body: { eventKey: "2026bbb" } });
    const mine = await jsonAs<Record<string, unknown>>(a.admin, "/admin/settings");
    expect(mine).toEqual({
      eventKey: "2026aaa",
      nexusEventKey: "",
      iframeUrl: "",
      teamNumber: a.teamId.replace("frc", ""),
    });
    expect(await jsonAs(b.admin, "/admin/settings")).toMatchObject({ eventKey: "2026bbb" });
    const keys = await database
      .prepare("SELECT key FROM settings WHERE team_id = ? ORDER BY key")
      .bind(a.teamId)
      .all<{ key: string }>();
    expect(keys.results.map((row) => row.key)).toEqual(["eventKey"]);
  });
});

async function seed(team: TeamUsers): Promise<Seeded> {
  const tag = `T${crypto.randomUUID().slice(0, 8)}`;
  const list = await jsonAs<{ id: number }>(
    team.student,
    "/lists",
    { method: "POST", body: { name: `List ${tag}`, description: `About ${tag}` } },
    201,
  );
  const item = await jsonAs<{ id: number }>(
    team.student,
    `/lists/${list.id}/items`,
    { method: "POST", body: { name: `Item ${tag}`, type: "item" } },
    201,
  );
  await callAs(team.student, `/lists/${list.id}/items/${item.id}/checked`, {
    method: "PATCH",
    body: { checked: true },
  });
  const issue = await jsonAs<{ id: number }>(
    team.student,
    `/lists/${list.id}/items/${item.id}/issues`,
    { method: "POST", body: { text: `Issue ${tag}` } },
    201,
  );
  const battery = await jsonAs<{ id: number }>(
    team.student,
    "/batteries",
    { method: "POST", body: { name: `Battery ${tag}` } },
    201,
  );
  await callAs(team.admin, "/admin/settings", {
    method: "PATCH",
    body: { eventKey: `2026${tag}`, iframeUrl: `https://example.com/${tag}` },
  });
  return {
    params: (path, name) => {
      if (name === "itemId") return String(item.id);
      if (name === "issueId") return String(issue.id);
      if (name === "id") return String(path.startsWith("/batteries") ? battery.id : list.id);
      return undefined;
    },
    markers: [tag],
    data: { item: item.id },
  };
}

async function snapshot(teamId: string) {
  const out: Record<string, unknown> = {};
  for (const table of ["checklist_lists", "checklist_items", "checklist_issues", "batteries"]) {
    out[table] = (
      await database
        .prepare(`SELECT * FROM ${table} WHERE team_id = ? ORDER BY id`)
        .bind(teamId)
        .all()
    ).results;
  }
  out.settings = (
    await database
      .prepare("SELECT * FROM settings WHERE team_id = ? ORDER BY key")
      .bind(teamId)
      .all()
  ).results;
  return out;
}

it("keeps every team's checklists, batteries and settings to itself", async () => {
  const { problems, requests } = await checkIsolation({
    app,
    seed,
    snapshot,
    // Calls The Blue Alliance, Nexus and Statbotics over the internet; it reads only the team's
    // own settings, which the settings test above covers.
    skip: ["GET /monitor/data"],
    bodies: (b) => ({
      "PATCH /lists/:id/name": { name: "Renamed" },
      "PATCH /lists/:id/description": { description: "Changed" },
      "PATCH /lists/:id/items/reorder": { ids: [(b.data as { item: number }).item] },
      "POST /lists/:id/items": { name: "New", type: "item" },
      "PATCH /lists/:id/items/:itemId/name": { name: "Renamed" },
      "PATCH /lists/:id/items/:itemId/description": { description: "Changed" },
      "PATCH /lists/:id/items/:itemId/checked": { checked: false },
      "POST /lists/:id/items/:itemId/issues": { text: "Mine now" },
      "PATCH /batteries/:id/state": { state: "Broken" },
      "PATCH /batteries/:id/voltage": { voltage: 1 },
      "PATCH /admin/settings": { eventKey: "2026mine" },
    }),
  });
  expect(problems).toEqual([]);
  expect(requests).toBeGreaterThan(80);
});
