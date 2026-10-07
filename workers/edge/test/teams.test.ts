import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { afterEach, describe, expect, it } from "vitest";
import { networkScheduled } from "../src/modules/network";
import { boxCall } from "./box";

// Each team has its own box (roadmap Phase 3, E.1 and E.2): its own key, its own link, its own
// data and settings, and its days counted in the box's own time zone.

const database = (env as unknown as { EDGE_DB: D1Database }).EDGE_DB;
const DAY = 86400;

async function teamWithBox() {
  const team = teamUsers(newTeamId());
  const { key } = await jsonAs<{ key: string }>(team.admin, "/box/key", { method: "POST" }, 201);
  return { team, key };
}

const open: WebSocket[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.close(1000);
});

describe("box keys", () => {
  it("open only their own team's address", async () => {
    const a = await teamWithBox();
    const b = await teamWithBox();
    expect((await boxCall(a.team.teamId, a.key, "/agent/network/state")).status).toBe(200);
    expect((await boxCall(b.team.teamId, a.key, "/agent/network/state")).status).toBe(401);
    // A team with no box at all.
    expect((await boxCall(newTeamId(), a.key, "/agent/network/state")).status).toBe(401);
  });

  it("stop working once the team makes a new one", async () => {
    const { team, key } = await teamWithBox();
    const { key: next } = await jsonAs<{ key: string }>(
      team.admin,
      "/box/key",
      { method: "POST" },
      201,
    );
    expect((await boxCall(team.teamId, key, "/agent/network/state")).status).toBe(401);
    expect((await boxCall(team.teamId, next, "/agent/network/state")).status).toBe(200);
    expect(await jsonAs(team.admin, "/box")).toMatchObject({ box: { keyHint: next.slice(-4) } });
  });

  it("are made only by admins, never from a kiosk", async () => {
    const team = teamUsers(newTeamId());
    expect((await callAs(team.student, "/box/key", { method: "POST" })).status).toBe(403);
    expect((await callAs(team.mentor, "/box/key", { method: "POST" })).status).toBe(403);
    expect((await callAs(team.kioskAdmin, "/box/key", { method: "POST" })).status).toBe(403);
  });
});

describe("the box's link", () => {
  it("is the team's own: another team never sees it connected", async () => {
    const a = await teamWithBox();
    const b = await teamWithBox();
    const res = await boxCall(a.team.teamId, a.key, "/agent/connect", {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    if (res.webSocket) open.push(res.webSocket);
    const state = async (user: typeof a.team.student) =>
      (await jsonAs<{ state: string; connectedAt: number | null }>(user, "/status/connection"))
        .connectedAt;
    expect(await state(a.team.student)).not.toBeNull();
    expect(await state(b.team.student)).toBeNull();
    // The check waits for the box to answer, which this one never does.
  }, 30_000);
});

describe("a team's network data", () => {
  it("is counted per team, even for keys every box sends", async () => {
    const a = await teamWithBox();
    const b = await teamWithBox();
    const ts = Math.floor(Date.now() / 1000 / 300) * 300 - 600;
    for (const [{ team, key }, bytes] of [
      [a, 1000],
      [b, 7000],
    ] as const) {
      await boxCall(team.teamId, key, "/agent/network/usage", {
        method: "POST",
        body: JSON.stringify({ samples: [[ts, "_wan", bytes, 0]], clients: [] }),
      });
    }
    const used = async (user: typeof a.team.student) =>
      (await jsonAs<{ used: number }>(user, "/network/overview")).used;
    expect(await used(a.team.student)).toBe(1000);
    expect(await used(b.team.student)).toBe(7000);
  });

  it("starts a new team with no cap set and cycles from the 1st", async () => {
    const team = teamUsers(newTeamId());
    expect(await jsonAs(team.student, "/network/settings")).toEqual({
      capBytes: 0,
      cycleStartDay: 1,
    });
  });
});

describe("local time", () => {
  it("is the box's: days and 'until midnight' grants follow the zone it reports", async () => {
    const { team, key } = await teamWithBox();
    const mac = "02:aa:bb:cc:dd:01";
    const now = Math.floor(Date.now() / 1000);
    await boxCall(team.teamId, key, "/agent/network/usage", {
      method: "POST",
      headers: { "X-G3-Agent-Time-Zone": "Pacific/Auckland" },
      body: JSON.stringify({
        samples: [[Math.floor(now / 300) * 300 - 300, mac, 10, 10]],
        clients: [{ mac, hostname: "laptop", ip: "192.168.50.9" }],
      }),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(await jsonAs(team.student, "/me")).toMatchObject({ timeZone: "Pacific/Auckland" });

    const grant = await jsonAs<{ expiresAt: number }>(team.admin, "/network/control/grants", {
      method: "POST",
      body: { mac, blocklistId: null, duration: "today" },
    });
    const midnight = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Auckland",
      hourCycle: "h23",
      hour: "numeric",
      minute: "numeric",
    }).format(new Date(grant.expiresAt * 1000));
    expect(midnight).toBe("00:00");
    expect(grant.expiresAt - now).toBeLessThanOrEqual(DAY);
  });
});

describe("the nightly rollup", () => {
  it("rolls each team's old rows into its own, in its box's days", async () => {
    const a = await teamWithBox();
    const b = await teamWithBox();
    const old = Math.floor((Date.now() / 1000 - 40 * DAY) / 3600) * 3600;
    for (const { team } of [a, b]) {
      await database
        .prepare(
          "INSERT INTO net_usage (team_id, mac, ts, dl_bytes, ul_bytes) VALUES (?1, '_wan', ?2, 5, 1), (?1, '_wan', ?3, 7, 1)",
        )
        .bind(team.teamId, old, old + 300)
        .run();
      await database
        .prepare(
          "INSERT INTO net_site_usage (team_id, mac, ts, site, dl_bytes, ul_bytes) VALUES (?, 'm', ?, 'x.com', 3, 1)",
        )
        .bind(team.teamId, old)
        .run();
    }
    await database
      .prepare(
        "INSERT INTO edge_status (team_id, agent_version, agent_started_at, last_seen_at, time_zone) VALUES (?, 't', 1, 1, 'Pacific/Auckland')",
      )
      .bind(b.team.teamId)
      .run();

    await networkScheduled(env as never);

    for (const { team } of [a, b]) {
      const hourly = await database
        .prepare("SELECT ts, dl_bytes AS dl FROM net_usage_hourly WHERE team_id = ?")
        .bind(team.teamId)
        .all<{ ts: number; dl: number }>();
      expect(hourly.results).toEqual([{ ts: old, dl: 12 }]);
      const raw = await database
        .prepare("SELECT count(*) AS n FROM net_usage WHERE team_id = ?")
        .bind(team.teamId)
        .first<{ n: number }>();
      expect(raw?.n).toBe(0);
    }
    const day = async (teamId: string) =>
      (
        await database
          .prepare("SELECT ts FROM net_site_usage_daily WHERE team_id = ?")
          .bind(teamId)
          .first<{ ts: number }>()
      )?.ts;
    // A (no zone reported): a UTC day. B: Auckland's standard-time day (UTC+12).
    expect(await day(a.team.teamId)).toBe(Math.floor(old / DAY) * DAY);
    expect(await day(b.team.teamId)).toBe(Math.floor((old + 12 * 3600) / DAY) * DAY - 12 * 3600);
  });
});
