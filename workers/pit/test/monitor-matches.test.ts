import { describe, expect, it } from "vitest";
import {
  type TbaMatch,
  ourSchedule,
  scheduleFromTba,
  tbaResult,
  withResults,
} from "../src/monitor-matches";

// The Monitor's match list: scores from The Blue Alliance on the matches that have been played.

const qual12: TbaMatch = {
  key: "2030test_qm12",
  comp_level: "qm",
  match_number: 12,
  time: 1_900_000_000,
  winning_alliance: "blue",
  alliances: {
    red: { team_keys: ["frc1", "frc2", "frc3"], score: 40 },
    blue: { team_keys: ["frc1648", "frc5", "frc6"], score: 55 },
  },
};
const qual13: TbaMatch = {
  key: "2030test_qm13",
  comp_level: "qm",
  match_number: 13,
  time: 1_900_000_600,
  winning_alliance: "",
  alliances: {
    red: { team_keys: ["frc1648", "frc8", "frc9"], score: -1 },
    blue: { team_keys: ["frc10", "frc11", "frc12"], score: -1 },
  },
};

describe("match results", () => {
  it("reads a played match's score and winner, and nothing before it's played", () => {
    // A season Gearbox doesn't know the bonus RPs of: no dots.
    expect(tbaResult(qual12)).toEqual({ red: 40, blue: 55, winner: "blue", bonus: null });
    expect(tbaResult(qual13)).toBeNull();
    const tie = {
      ...qual12,
      winning_alliance: "",
      alliances: { red: { score: 7 }, blue: { score: 7 } },
    };
    expect(tbaResult(tie)?.winner).toBe("tie");
  });

  it("reads a qualification match's bonus RPs for the season, and none for a playoff", () => {
    const played: TbaMatch = {
      ...qual12,
      key: "2026test_qm12",
      score_breakdown: {
        red: { energizedAchieved: true, superchargedAchieved: false, traversalAchieved: true },
        blue: { energizedAchieved: false, superchargedAchieved: false, traversalAchieved: false },
      },
    };
    expect(tbaResult(played)?.bonus).toEqual({
      labels: ["Energized Bonus", "Supercharged Bonus", "Traversal Bonus"],
      red: [true, false, true],
      blue: [false, false, false],
    });
    expect(tbaResult({ ...played, key: "2026test_sf1m1", comp_level: "sf" })?.bonus).toBeNull();
  });

  it("adds The Blue Alliance's scores to Nexus's matches by name and teams", () => {
    const nexus = [
      { label: "Practice 1", redTeams: ["1648"], blueTeams: ["5"] },
      { label: "Qualification 12", redTeams: ["1", "2", "3"], blueTeams: ["1648", "5", "6"] },
      { label: "Qualification 13", redTeams: ["1648", "8", "9"], blueTeams: ["10", "11", "12"] },
      // Nexus has other teams than The Blue Alliance: not the same match.
      { label: "Qualification 12", redTeams: ["99"], blueTeams: [] },
    ];
    const [practice, played, upcoming, other] = withResults(nexus, [qual12, qual13]) as {
      result: unknown;
    }[];
    expect(practice.result).toBeNull();
    expect(played).toMatchObject({ label: "Qualification 12", result: { winner: "blue" } });
    expect(upcoming.result).toBeNull();
    expect(other.result).toBeNull();
  });

  it("builds the schedule from The Blue Alliance with short names and scores", () => {
    const [first, second] = scheduleFromTba([qual13, qual12]);
    expect(first).toMatchObject({
      label: "Qual 12",
      blueTeams: ["1648", "5", "6"],
      result: { red: 40, blue: 55, winner: "blue" },
    });
    expect(second).toMatchObject({ label: "Qual 13", result: null });
  });

  it("gives a Nexus match without times The Blue Alliance's", () => {
    const predicted = { ...qual13, predicted_time: 1_900_000_900 };
    const [untimed, timed] = withResults(
      [
        { label: "Qualification 13", redTeams: ["1648", "8", "9"], times: {} },
        {
          label: "Qualification 13",
          redTeams: ["1648", "8", "9"],
          times: { estimatedStartTime: 5 },
        },
      ],
      [predicted],
    ) as { times: Record<string, number>; timesFromTba?: boolean }[];
    expect(untimed).toMatchObject({
      times: { estimatedStartTime: 1_900_000_900_000, estimatedQueueTime: 1_900_000_600_000 },
      timesFromTba: true,
    });
    expect(timed.times).toEqual({ estimatedStartTime: 5 });
    expect(timed.timesFromTba).toBeUndefined();
  });
});

describe("our next match", () => {
  type Status = "Queuing soon" | "Now queuing" | "On deck" | "On field";
  /** An event of `count` matches, 1648 on blue in the ones listed. */
  const event = (count: number, ours: number[], statuses: Record<number, Status> = {}) =>
    Array.from({ length: count }, (_, index) => ({
      label: `Qualification ${index + 1}`,
      status: statuses[index] ?? ("Queuing soon" as Status),
      redTeams: ["1", "2", "3"],
      blueTeams: ours.includes(index) ? ["4", "1648", "6"] : ["7", "8", "9"],
      times: { estimatedQueueTime: 1000 + index, estimatedStartTime: 2000 + index },
      result: null as { red: number; blue: number; winner: "red" } | null,
    }));

  it("counts the matches until we're called to queue, then until we're on the field", () => {
    // 1–4 played (On field), 5 on the field, 6 on deck, 7 queuing; ours is 10.
    const matches = event(12, [9], {
      0: "On field",
      1: "On field",
      2: "On field",
      3: "On field",
      4: "On field",
      5: "On deck",
      6: "Now queuing",
    });
    expect(ourSchedule(matches, "1648", true)).toEqual({
      total: 1,
      next: {
        label: "Qualification 10",
        alliance: "blue",
        redTeams: ["1", "2", "3"],
        blueTeams: ["4", "1648", "6"],
        status: "Queuing soon",
        matchesUntilQueuing: 3,
        matchesUntilField: 5,
        queueTime: 1009,
        queued: false,
        onFieldTime: null,
        startTime: 2009,
        timesFrom: "nexus",
      },
    });

    matches[9].status = "Now queuing";
    Object.assign(matches[9].times, { actualQueueTime: 999 });
    expect(ourSchedule(matches, "1648", true).next).toMatchObject({
      status: "Now queuing",
      matchesUntilQueuing: null,
      queueTime: 999,
      queued: true,
    });
  });

  it("passes over a match of ours that's over, even before its score is in", () => {
    const matches = event(6, [1, 4], { 0: "On field", 1: "On field", 2: "On field" });
    expect(ourSchedule(matches, "1648", true).next).toMatchObject({
      label: "Qualification 5",
      matchesUntilField: 2,
      matchesUntilQueuing: 2,
    });
    // On the field now, with no score yet: still ours.
    matches[3].status = "On field";
    matches[4].status = "On field";
    expect(ourSchedule(matches, "1648", true).next).toMatchObject({
      label: "Qualification 5",
      status: "On field",
      matchesUntilField: 0,
    });
  });

  it("before the first call, counts from the start", () => {
    const matches = event(5, [2]);
    expect(ourSchedule(matches, "1648", true).next).toMatchObject({
      matchesUntilQueuing: 3,
      matchesUntilField: 3,
    });
  });

  it("says when we have no more matches, or none at all", () => {
    const matches = event(3, [0], { 0: "On field", 1: "On field" });
    expect(ourSchedule(matches, "1648", true)).toEqual({ next: null, total: 1 });
    expect(ourSchedule(matches, "254", true)).toEqual({ next: null, total: 0 });
  });

  it("on The Blue Alliance's schedule, counts from the last score and says no status", () => {
    const matches = event(6, [4]);
    matches[0].result = { red: 1, blue: 0, winner: "red" };
    matches[1].result = { red: 1, blue: 0, winner: "red" };
    expect(ourSchedule(matches, "1648", false).next).toMatchObject({
      label: "Qualification 5",
      status: null,
      matchesUntilQueuing: null,
      matchesUntilField: 2,
      timesFrom: "tba",
    });
  });
});
