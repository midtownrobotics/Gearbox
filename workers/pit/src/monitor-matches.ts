import { tbaMatchLabel } from "./archives";

// The Monitor's match list: the event's schedule from Nexus, else The Blue Alliance, with each
// played match's score from The Blue Alliance.

interface TbaAlliance {
  team_keys?: string[];
  /** -1 (or null) until the match has been played. */
  score?: number | null;
}

export interface TbaMatch {
  key?: string;
  comp_level?: string;
  match_number?: number;
  predicted_time?: number | null;
  time?: number | null;
  /** "red", "blue", or "" for a tie or a match not played yet. */
  winning_alliance?: string | null;
  alliances?: { blue?: TbaAlliance; red?: TbaAlliance };
}

/** A played match's score. `winner` takes a playoff tiebreaker into account. */
export type MatchResult = { red: number; blue: number; winner: "red" | "blue" | "tie" };

export interface MonitorScheduleMatch {
  label: string;
  status: "Queuing soon";
  blueTeams: string[] | null;
  redTeams: string[] | null;
  times: {
    estimatedStartTime: number | null;
    estimatedQueueTime: number | null;
  };
  result: MatchResult | null;
}

const teamsOf = (alliance: TbaAlliance | undefined) =>
  alliance?.team_keys?.map((key) => key.replace(/^frc/, "")) ?? null;

/** A Blue Alliance match's score, or null while it hasn't been played. */
export function tbaResult(match: TbaMatch): MatchResult | null {
  const red = match.alliances?.red?.score;
  const blue = match.alliances?.blue?.score;
  if (typeof red !== "number" || typeof blue !== "number" || red < 0 || blue < 0) return null;
  const winner =
    match.winning_alliance === "red" || match.winning_alliance === "blue"
      ? match.winning_alliance
      : red > blue
        ? "red"
        : blue > red
          ? "blue"
          : "tie";
  return { red, blue, winner };
}

/** The Blue Alliance's schedule in Nexus's shape, for an event Nexus doesn't have. */
export function scheduleFromTba(matches: TbaMatch[]): MonitorScheduleMatch[] {
  return matches
    .filter((match) => match.comp_level && match.match_number)
    .map<MonitorScheduleMatch>((match) => ({
      label: tbaMatchLabel(match.key) || `${match.comp_level?.toUpperCase()}${match.match_number}`,
      status: "Queuing soon", // The Blue Alliance doesn't say where a match is
      blueTeams: teamsOf(match.alliances?.blue),
      redTeams: teamsOf(match.alliances?.red),
      times: {
        estimatedStartTime: match.predicted_time
          ? match.predicted_time * 1000
          : match.time
            ? match.time * 1000
            : null,
        // About 5 minutes before it starts.
        estimatedQueueTime: match.predicted_time ? (match.predicted_time - 300) * 1000 : null,
      },
      result: tbaResult(match),
    }))
    .sort((a, b) => (a.times.estimatedStartTime ?? 0) - (b.times.estimatedStartTime ?? 0));
}

type NexusMatch = { label?: unknown; redTeams?: unknown; blueTeams?: unknown };

/** Whether every team Nexus has on each alliance is on the same one at The Blue Alliance. */
function sameAlliances(nexus: NexusMatch, tba: TbaMatch): boolean {
  const fits = (nexusTeams: unknown, tbaTeams: string[] | null) =>
    !Array.isArray(nexusTeams) ||
    nexusTeams.every((team) => team == null || tbaTeams?.includes(String(team)));
  return (
    fits(nexus.redTeams, teamsOf(tba.alliances?.red)) &&
    fits(nexus.blueTeams, teamsOf(tba.alliances?.blue))
  );
}

/**
 * Nexus's matches, each with its score from The Blue Alliance once it's been played (null before,
 * and for practice matches, which The Blue Alliance doesn't have). Matched by name ("Qualification
 * 12" is qm12) and checked by who's playing.
 */
export function withResults(nexusMatches: unknown[], tbaMatches: TbaMatch[]): unknown[] {
  const byLabel = new Map<string, TbaMatch>();
  for (const match of tbaMatches) {
    const label = tbaMatchLabel(match.key);
    if (label) byLabel.set(label, match);
  }
  return nexusMatches.map((raw) => {
    const match = (raw ?? {}) as NexusMatch;
    const label =
      typeof match.label === "string" ? match.label.replace(/^Qualification\b/, "Qual") : "";
    const tba = byLabel.get(label);
    return {
      ...match,
      result: tba && sameAlliances(match, tba) ? tbaResult(tba) : null,
    };
  });
}
