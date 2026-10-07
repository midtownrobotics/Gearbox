import { env } from "cloudflare:test";
import { type Seeded, checkIsolation } from "@g3/testing/isolation";
import type { TeamUsers } from "@g3/testing/users";
import { jsonAs } from "@g3/testing/worker";
import { expect, it } from "vitest";
import { app } from "../src/index";
import { boxCall } from "./box";

// Two teams, each with its own box (and key), the usage and sites its box uploaded, a named
// client, a blocklist with an exception for that client, and its own settings. Every route, called
// as team A's admin, mentor, student and kiosk session with team B's ids, must show none of B's and
// change nothing of B's. (Nothing reaches a box here: no box is connected in tests.)

/** A site both teams' boxes visited. */
const SHARED_SITE = "shared.example.com";
const database = (env as unknown as { EDGE_DB: D1Database }).EDGE_DB;
const TABLES = [
  "edge_boxes",
  "edge_status",
  "edge_audit",
  "net_clients",
  "net_usage",
  "net_usage_hourly",
  "net_settings",
  "net_blocklists",
  "net_blocklist_domains",
  "net_grants",
  "net_site_usage",
  "net_site_usage_daily",
];

async function seed(team: TeamUsers): Promise<Seeded> {
  const tag = `t${crypto.randomUUID().slice(0, 8)}`;
  const mac = `02:${crypto.randomUUID().slice(0, 2)}:00:00:00:01`;
  const { admin } = team;
  const { key } = await jsonAs<{ key: string }>(admin, "/box/key", { method: "POST" }, 201);
  const box = (path: string, body: unknown) =>
    boxCall(team.teamId, key, path, { method: "POST", body: JSON.stringify(body) });

  const hour = Math.floor(Date.now() / 1000 / 3600) * 3600 - 3600;
  expect(
    (
      await box("/agent/network/usage", {
        samples: [
          [hour, mac, 1000, 200],
          [hour, "_wan", 5000, 900],
        ],
        clients: [{ mac, hostname: `host-${tag}`, ip: "192.168.50.20" }],
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await box("/agent/network/sites", {
        rows: [
          [hour, mac, `${tag}.example.com`, 800, 100],
          [hour, mac, SHARED_SITE, 50, 5],
        ],
      })
    ).status,
  ).toBe(200);
  await jsonAs(admin, `/network/clients/${encodeURIComponent(mac)}`, {
    method: "PATCH",
    body: { displayName: `Laptop ${tag}` },
  });
  await jsonAs(admin, "/network/settings", {
    method: "PATCH",
    body: { capBytes: 123_000_000_000, cycleStartDay: 9 },
  });
  const list = await jsonAs<{ id: number }>(admin, "/network/control/blocklists", {
    method: "POST",
    body: { name: `List ${tag}`, action: "block", enabled: true, domains: [`${tag}.games.com`] },
  });
  const grant = await jsonAs<{ id: number }>(admin, "/network/control/grants", {
    method: "POST",
    body: { mac, blocklistId: list.id, duration: "1h", reason: `Homework ${tag}` },
  });

  return {
    params: (path, name) => {
      if (name === "mac") return mac;
      // A site both teams' boxes visited (the page repeats the name it's asked about): A's page for
      // it must list only A's devices.
      if (name === "site") return SHARED_SITE;
      if (path.includes("/blocklists/")) return String(list.id);
      if (path.includes("/grants/")) return String(grant.id);
      return undefined;
    },
    markers: [tag],
    data: { mac, list: list.id },
  };
}

async function snapshot(teamId: string) {
  const out: Record<string, unknown> = {};
  for (const table of TABLES) {
    out[table] = (
      await database
        .prepare(`SELECT * FROM ${table} WHERE team_id = ? ORDER BY 1, 2`)
        .bind(teamId)
        .all()
    ).results;
  }
  return out;
}

it("keeps every team's box, network and browsing data to itself", async () => {
  const { problems, requests } = await checkIsolation({
    app,
    seed,
    snapshot,
    bodies: (b) => {
      const d = b.data as { mac: string; list: number };
      return {
        "PATCH /network/clients/:mac": { displayName: "Mine now" },
        "PATCH /network/settings": { capBytes: 1, cycleStartDay: 2 },
        "PATCH /network/control/settings": { enforce: true },
        "POST /network/control/blocklists": {
          name: "Mine",
          action: "block",
          enabled: true,
          domains: ["mine.com"],
        },
        "PUT /network/control/blocklists/:id": {
          name: "Taken",
          action: "block",
          enabled: false,
          domains: [],
        },
        "POST /network/control/grants": {
          mac: d.mac,
          blocklistId: d.list,
          duration: "4h",
          reason: "Not yours",
        },
        "POST /lookup": { url: "https://example.com/product" },
      };
    },
  });
  expect(problems).toEqual([]);
  expect(requests).toBeGreaterThan(100);
}, 120_000);
