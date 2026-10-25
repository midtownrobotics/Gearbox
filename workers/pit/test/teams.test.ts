import { env } from "cloudflare:test";
import {
  type Seeded,
  checkIsolation,
  checkTeamDeletion,
  checkTeamExport,
} from "@g3/testing/isolation";
import { type TeamUsers, newTeamId, teamUsers } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";

// Pit for many teams: each team's checklists, their archives, batteries and settings are its own,
// its team number is its own, and the Blue Alliance and Nexus API keys are the platform's, never a
// team setting.

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
  // An archive of the list above (which unchecks its item), for the team's event.
  const archive = await jsonAs<{ id: number }>(
    team.student,
    "/archives",
    { method: "POST", body: { type: "match", details: `Qual ${tag}` } },
    201,
  );
  // A paired log downloader, as the downloader pairs: on the team's address, with no session.
  const { code } = await jsonAs<{ code: string }>(
    team.mentor,
    "/downloaders/codes",
    { method: "POST" },
    201,
  );
  const paired = (await (
    await call("/downloaders/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Team-Id": team.teamId },
      body: JSON.stringify({ code, name: `Downloader ${tag}` }),
    })
  ).json()) as { id: number; key: string };
  const asDownloader = { Authorization: `Bearer ${paired.key}`, "X-Team-Id": team.teamId };
  // A match log it uploaded, gzipped like the downloader sends them, in one part.
  const gzipped = new Uint8Array(
    await new Response(
      new Blob([`log ${tag}`]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  const log = (await (
    await call("/downloader/logs", {
      method: "POST",
      headers: { ...asDownloader, "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "seed",
        name: "Qual-1",
        matchType: "q",
        matchNumber: 1,
        size: gzipped.length,
        rawSize: 4 + tag.length,
      }),
    })
  ).json()) as { id: number };
  const part = (await (
    await call(`/downloader/logs/${log.id}/parts/1`, {
      method: "PUT",
      headers: asDownloader,
      body: gzipped,
    })
  ).json()) as { partNumber: number; etag: string };
  await call(`/downloader/logs/${log.id}/complete`, {
    method: "POST",
    headers: { ...asDownloader, "Content-Type": "application/json" },
    body: JSON.stringify({ parts: [part] }),
  });
  // AdvantageScope: the team's layout, and an asset a mentor uploaded (a zip of one stored file).
  await callAs(team.student, "/scope/settings", {
    method: "PUT",
    body: { settings: { "AdvantageScopeLite/state": JSON.stringify({ tag }) } },
  });
  const assetName = `Robot_${tag}`;
  const form = new FormData();
  form.append(
    "file",
    new File([storedZip(`${assetName}/config.json`, `{"name":"${tag}"}`)], "a.zip"),
  );
  await callAs(team.mentor, "/scope/assets", { method: "POST", body: form });
  return {
    params: (path, name) => {
      if (name === "itemId") return String(item.id);
      if (name === "issueId") return String(issue.id);
      if (name === "name") return assetName;
      if (name === "file")
        return path.startsWith("/scope/logs") ? "seed_Qual-1.wpilog" : "config.json";
      if (name === "id") {
        if (path.startsWith("/batteries")) return String(battery.id);
        if (path.startsWith("/downloaders")) return String(paired.id);
        if (path.startsWith("/logs") || path.startsWith("/downloader/logs")) return String(log.id);
        return String(path.startsWith("/archives") ? archive.id : list.id);
      }
      return undefined;
    },
    markers: [tag],
    data: { item: item.id, log: log.id },
  };
}

async function snapshot(teamId: string) {
  const out: Record<string, unknown> = {};
  for (const table of [
    "checklist_lists",
    "checklist_items",
    "checklist_issues",
    "checklist_archives",
    "batteries",
    "log_downloaders",
    "match_logs",
    "scope_assets",
  ]) {
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
  out.scope_settings = (
    await database
      .prepare("SELECT * FROM scope_settings WHERE team_id = ? ORDER BY key")
      .bind(teamId)
      .all()
  ).results;
  out.log_downloader_codes = (
    await database
      .prepare("SELECT * FROM log_downloader_codes WHERE team_id = ? ORDER BY code")
      .bind(teamId)
      .all()
  ).results;
  return out;
}

it("keeps every team's checklists, archives, batteries, settings and log downloaders to itself", async () => {
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
      "POST /archives": { type: "other", event: "Mine", details: "Mine now" },
      "PATCH /batteries/:id/state": { state: "Broken" },
      "PATCH /batteries/:id/voltage": { voltage: 1 },
      "POST /batteries/timers": { paused: true },
      "PUT /admin/event-snapshot": { on: true },
      "PATCH /admin/settings": { eventKey: "2026mine" },
      "POST /downloaders/pair": { code: "123456", name: "Mine now" },
      "PUT /logs/settings": { whenFull: "delete-oldest" },
      "DELETE /logs": { ids: [(b.data as { log: number }).log] },
      "PUT /scope/settings": { settings: { "AdvantageScopeLite/state": "{}" } },
    }),
  });
  expect(problems).toEqual([]);
  expect(requests).toBeGreaterThan(80);
}, 60_000);

it("deletes a team's data when an operator deletes the team, and only that team's", async () => {
  const problems = await checkTeamDeletion({
    seed,
    snapshot,
    // As the platform calls it, over the service binding (the gateway never answers /internal).
    remove: (teamId) => call(`/internal/teams/${teamId}`, { method: "DELETE" }),
  });
  expect(problems).toEqual([]);
}, 60_000);

it("exports a team's data for its admins, and only that team's", async () => {
  const problems = await checkTeamExport({
    seed,
    // As the platform calls it when an admin downloads the app's data.
    exportOf: (teamId) => call(`/internal/teams/${teamId}/export`),
  });
  expect(problems).toEqual([]);
}, 60_000);

/** A zip of one stored file (no CRC: Pit's reader doesn't check it). */
function storedZip(path: string, text: string) {
  const encoder = new TextEncoder();
  const name = encoder.encode(path);
  const data = encoder.encode(text);
  const zip = new Uint8Array(30 + name.length + data.length + 46 + name.length + 22);
  const view = new DataView(zip.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint32(18, data.length, true);
  view.setUint32(22, data.length, true);
  view.setUint16(26, name.length, true);
  zip.set(name, 30);
  zip.set(data, 30 + name.length);
  const central = 30 + name.length + data.length;
  view.setUint32(central, 0x02014b50, true);
  view.setUint32(central + 20, data.length, true);
  view.setUint32(central + 24, data.length, true);
  view.setUint16(central + 28, name.length, true);
  zip.set(name, central + 46);
  const end = central + 46 + name.length;
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end + 8, 1, true);
  view.setUint16(end + 10, 1, true);
  view.setUint32(end + 12, 46 + name.length, true);
  view.setUint32(end + 16, central, true);
  return zip;
}
