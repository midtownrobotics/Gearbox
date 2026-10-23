import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { snapshotAvailable } from "../src/event-snapshot";

// The Monitor's event snapshot (GRITS 2026 halfway through qualifications), offered in dev and
// staging only (src/event-snapshot.ts). Tests run with the dev config, so it's offered here.

type Match = {
  label: string;
  status: string;
  times: { estimatedStartTime: number };
  result: { red: number; blue: number; winner: string } | null;
};
type MonitorData = {
  teamNumber: string;
  snapshot: { name: string } | null;
  nexus: { isRealNexus: boolean; matches: Match[] };
  ourMatches: { next: Record<string, unknown> | null; total: number } | null;
  ranking: { rank: number; wins: number; losses: number } | null;
  contextRankings: { top3: unknown[]; context: unknown[] } | null;
};

describe("event snapshot", () => {
  it("is offered in dev and staging, never in production", () => {
    expect(snapshotAvailable({ LOCAL_GATEWAY_URL: "http://localhost:8796" })).toBe(true);
    expect(snapshotAvailable({ LOCAL_GATEWAY_URL: undefined })).toBe(false);
  });

  it("is switched on and off by admins, and the Monitor shows it while it's on", async () => {
    const team = teamUsers(newTeamId());
    expect(await jsonAs(team.admin, "/admin/event-snapshot")).toEqual({
      available: true,
      on: false,
      name: "GRITS 2026",
    });
    for (const user of [team.student, team.mentor, team.kioskAdmin]) {
      const res = await callAs(user, "/admin/event-snapshot", {
        method: "PUT",
        body: { on: true },
      });
      expect(res.status).toBe(403);
    }

    const before = Date.now();
    await jsonAs(team.admin, "/admin/event-snapshot", { method: "PUT", body: { on: true } });
    expect(await jsonAs(team.admin, "/admin/event-snapshot")).toMatchObject({ on: true });

    const data = await jsonAs<MonitorData>(team.student, "/monitor/data");
    expect(data.snapshot?.name).toBe("GRITS 2026");
    expect(data.teamNumber).toBe("1648");
    const { matches } = data.nexus;
    expect(data.nexus.isRealNexus).toBe(true);
    expect(matches).toHaveLength(59);
    expect(matches.filter((m) => m.result).length).toBe(30);
    expect(matches[30]).toMatchObject({ label: "Qualification 31", status: "On field" });
    expect(matches[33].status).toBe("Queuing soon");
    // Its clock starts when it was switched on: Qualification 31 starts then.
    expect(matches[30].times.estimatedStartTime).toBeGreaterThanOrEqual(before);
    // 1648 plays Qualification 35, two calls after Qualification 33's.
    expect(data.ourMatches?.next).toMatchObject({
      label: "Qualification 35",
      alliance: "blue",
      partners: ["4026", "6905"],
      opponents: ["1746", "3344", "5109"],
      status: "Queuing soon",
      matchesUntilQueuing: 2,
      matchesUntilField: 4,
      timesFrom: "nexus",
    });
    expect(data.ranking).toMatchObject({ rank: 16, wins: 2, losses: 2 });
    expect(data.contextRankings?.top3).toHaveLength(3);

    await jsonAs(team.admin, "/admin/event-snapshot", { method: "PUT", body: { on: false } });
    expect(await jsonAs(team.admin, "/admin/event-snapshot")).toMatchObject({ on: false });
  });
});
