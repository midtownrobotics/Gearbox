import { student } from "@g3/testing/users";
import { jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { type LoggedAction, SCORING, type Standing, leaderboard } from "../src/lib/leaderboard";

// The Leaderboard (src/lib/leaderboard.ts): steps completed, and points for the team's median
// minutes for each step, never the time the person took.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** A log built step by step: `step(user, instance, process, startMinute, endMinute)`. */
function log() {
  const rows: LoggedAction[] = [];
  return {
    rows,
    step(
      userId: string,
      partInstanceId: number,
      processId: number,
      from: number | null,
      to: number,
    ) {
      if (from !== null)
        rows.push({ userId, partInstanceId, processId, action: "started", createdAt: from * MIN });
      rows.push({ userId, partInstanceId, processId, action: "completed", createdAt: to * MIN });
    },
  };
}

const byUser = (standings: Standing[]) => Object.fromEntries(standings.map((s) => [s.userId, s]));

describe("leaderboard scoring", () => {
  it("gives every step the default before there are samples", () => {
    const l = log();
    l.step("a", 1, 10, null, 0);
    l.step("a", 2, 10, null, 1);
    expect(leaderboard(l.rows, new Map())).toEqual([
      { userId: "a", steps: 2, points: 2 * SCORING.defaultMinutes },
    ]);
  });

  it("scores a step by the part's median at that process, not by who was slow", () => {
    const l = log();
    const partOf = new Map<number, number>();
    // Part 100 at process 10: 20, 20, 20 and a slow 80 minutes: the median is 20.
    [20, 20, 20, 80].forEach((took, i) => {
      partOf.set(i + 1, 100);
      l.step(i === 3 ? "slow" : "quick", i + 1, 10, i * 1000, i * 1000 + took);
    });
    const s = byUser(leaderboard(l.rows, partOf));
    expect(s.quick).toEqual({ userId: "quick", steps: 3, points: 60 });
    expect(s.slow).toEqual({ userId: "slow", steps: 1, points: 20 });
  });

  it("falls back to the process's median for a part with too few samples", () => {
    const l = log();
    const partOf = new Map([
      [1, 100],
      [2, 100],
      [3, 100],
      [4, 200],
    ]);
    [6, 6, 6].forEach((took, i) => l.step("a", i + 1, 10, i * 100, i * 100 + took));
    l.step("b", 4, 10, null, 1000);
    expect(byUser(leaderboard(l.rows, partOf)).b.points).toBe(6);
  });

  it("splits a batch's time across its parts", () => {
    const l = log();
    const partOf = new Map<number, number>();
    // Three CAM jobs of 10 parts each, 30 minutes each: 3 minutes a part.
    for (let job = 0; job < 3; job++) {
      for (let p = 0; p < 10; p++) {
        const id = job * 10 + p;
        partOf.set(id, 100);
        l.rows.push({
          userId: "cam",
          partInstanceId: id,
          processId: 7,
          action: "started",
          createdAt: job * DAY,
        });
        l.rows.push({
          userId: "cam",
          partInstanceId: id,
          processId: 7,
          action: "completed",
          createdAt: job * DAY + 30 * MIN,
        });
      }
    }
    expect(leaderboard(l.rows, partOf)).toEqual([{ userId: "cam", steps: 30, points: 90 }]);
  });

  it("ignores jobs left open too long or marked done at once, and redone steps need a new start", () => {
    const l = log();
    const partOf = new Map([[1, 100]]);
    l.step("a", 1, 10, 0, 0.1); // too quick
    l.step("a", 1, 10, 1000, 1000 + 24 * 60); // left overnight
    l.step("a", 1, 10, null, 5000); // redone without a start
    // No samples: every step is worth the default.
    expect(leaderboard(l.rows, partOf)[0].points).toBe(3 * SCORING.defaultMinutes);
  });
});

describe("GET /leaderboard", () => {
  const post = (body?: unknown) => ({ method: "POST", body });
  type Id = { id: number };

  it("counts the steps someone completes", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const subsystem = await jsonAs<Id>(student, "/subsystems", post({ name: `Board ${tag}` }), 201);
    const saw = await jsonAs<Id>(student, "/processes", post({ name: `Saw ${tag}` }), 201);
    const definition = await jsonAs<Id>(
      student,
      "/part-definitions",
      post({
        onshapePartNumber: `LB-${tag}`,
        revision: "A",
        subsystemId: subsystem.id,
        name: `Spacer ${tag}`,
        processIds: [saw.id],
      }),
      201,
    );
    const [instance] = await jsonAs<Id[]>(
      student,
      "/part-instances",
      post({ partDefinitionId: definition.id, quantity: 1 }),
      201,
    );
    const before =
      (await jsonAs<{ standings: Standing[] }>(student, "/leaderboard")).standings.find(
        (s) => s.userId === student.id,
      )?.steps ?? 0;
    await jsonAs(
      student,
      `/part-instance-processes/${instance.id}/processes/${saw.id}/doing`,
      post(),
    );
    await jsonAs(
      student,
      `/part-instance-processes/${instance.id}/processes/${saw.id}/done`,
      post(),
    );

    const { standings } = await jsonAs<{ standings: Standing[] }>(student, "/leaderboard");
    const mine = standings.find((s) => s.userId === student.id);
    expect(mine?.steps).toBe(before + 1);
    expect(mine?.points).toBeGreaterThan(0);
  });
});
