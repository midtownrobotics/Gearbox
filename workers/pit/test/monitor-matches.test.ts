import { describe, expect, it } from "vitest";
import { type TbaMatch, scheduleFromTba, tbaResult, withResults } from "../src/monitor-matches";

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
    expect(tbaResult(qual12)).toEqual({ red: 40, blue: 55, winner: "blue" });
    expect(tbaResult(qual13)).toBeNull();
    const tie = {
      ...qual12,
      winning_alliance: "",
      alliances: { red: { score: 7 }, blue: { score: 7 } },
    };
    expect(tbaResult(tie)?.winner).toBe("tie");
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
});
