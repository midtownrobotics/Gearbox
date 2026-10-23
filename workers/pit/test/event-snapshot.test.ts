import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { movedClock, snapshotAvailable, statusesAt } from "../src/event-snapshot";

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
  snapshot: { name: string; clockMs: number } | null;
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
      blueTeams: ["1648", "4026", "6905"],
      redTeams: ["1746", "3344", "5109"],
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

  it("moves matches along in order, so one is always on deck between calls", () => {
    const minute = 60_000;
    // Nine minutes apart, then a break.
    const starts = [0, 9, 18, 27, 120].map((m) => m * minute);
    const at = (clock: number) => statusesAt(starts, clock * minute);
    expect(at(0)).toEqual(["On field", "On deck", "Now queuing", "Queuing soon", "Queuing soon"]);
    // The next match is due on the field at 4 minutes; until then it stays on deck.
    expect(at(3.5)).toEqual(["On field", "On deck", "Now queuing", "Queuing soon", "Queuing soon"]);
    expect(at(5.5)).toEqual(["On field", "On field", "On deck", "Now queuing", "Queuing soon"]);
    // After the last match before the break, the one after it isn't called yet.
    expect(at(30)).toEqual(["On field", "On field", "On field", "On field", "Queuing soon"]);
    expect(at(95)).toEqual(["On field", "On field", "On field", "On field", "On deck"]);
    // Before the first match goes on the field.
    expect(at(-20)).toEqual([
      "On deck",
      "Now queuing",
      "Queuing soon",
      "Queuing soon",
      "Queuing soon",
    ]);
  });

  it("moves its clock by minutes, a match at a time, or back to the start", () => {
    const minute = 60_000;
    expect(movedClock(0, { minutes: 3 })).toBe(3 * minute);
    // Qualification 32 starts 9 minutes after the snapshot's moment, 30 nine minutes before.
    expect(movedClock(0, { matches: 1 })).toBe(9 * minute);
    expect(movedClock(2 * minute, { matches: -1 })).toBe(0);
    expect(movedClock(12 * minute, { reset: true })).toBe(0);
    // Never more than an hour past the last match.
    expect(movedClock(0, { minutes: 24 * 60 })).toBeLessThan(24 * 60 * minute);
  });

  it("follows its clock: statuses, scores and our next match move with it", async () => {
    const team = teamUsers(newTeamId());
    // Only admins, and only while it's on.
    expect(
      (
        await callAs(team.admin, "/admin/event-snapshot/clock", {
          method: "PUT",
          body: { matches: 1 },
        })
      ).status,
    ).toBe(404);
    await jsonAs(team.admin, "/admin/event-snapshot", { method: "PUT", body: { on: true } });
    expect(
      (
        await callAs(team.student, "/admin/event-snapshot/clock", {
          method: "PUT",
          body: { matches: 1 },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await callAs(team.admin, "/admin/event-snapshot/clock", {
          method: "PUT",
          body: { minutes: 1.5 },
        })
      ).status,
    ).toBe(400);

    // A match on: Qualification 32 is on the field, and 34 is queuing, one call before ours (35).
    const moved = await jsonAs<{ clockMs: number }>(team.admin, "/admin/event-snapshot/clock", {
      method: "PUT",
      body: { matches: 1 },
    });
    expect(moved.clockMs).toBe(9 * 60_000);
    let data = await jsonAs<MonitorData>(team.student, "/monitor/data");
    const byLabel = (label: string) => data.nexus.matches.find((m) => m.label === label);
    expect(data.snapshot?.clockMs).toBeGreaterThanOrEqual(9 * 60_000);
    expect(byLabel("Qualification 32")?.status).toBe("On field");
    expect(byLabel("Qualification 33")?.status).toBe("On deck");
    expect(byLabel("Qualification 34")?.status).toBe("Now queuing");
    expect(data.ourMatches?.next).toMatchObject({
      label: "Qualification 35",
      matchesUntilQueuing: 1,
    });

    // An hour back: the matches since haven't been played.
    await jsonAs(team.admin, "/admin/event-snapshot/clock", {
      method: "PUT",
      body: { minutes: -60 },
    });
    data = await jsonAs<MonitorData>(team.student, "/monitor/data");
    expect(byLabel("Qualification 30")?.result).toBeNull();
    expect(byLabel("Qualification 30")?.status).toBe("Queuing soon");
    expect(byLabel("Qualification 20")?.result).not.toBeNull();
  });
});
