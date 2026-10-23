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
  /** The season's scoring details for each alliance; null until it's been played. */
  score_breakdown?: { red?: Record<string, unknown>; blue?: Record<string, unknown> } | null;
}

/** Which of a qualification match's bonus ranking points each alliance earned, in order. */
export type BonusRp = { labels: string[]; red: boolean[]; blue: boolean[] };

/** A played match's score. `winner` takes a playoff tiebreaker into account. */
export type MatchResult = {
  red: number;
  blue: number;
  winner: "red" | "blue" | "tie";
  /** Qualification matches only, and only for a season Gearbox knows (`BONUS_RP`). */
  bonus?: BonusRp | null;
};

/**
 * Each season's bonus ranking points, as The Blue Alliance names them, with the field of
 * `score_breakdown` that says an alliance earned it. The Blue Alliance shows them as dots by the
 * score; the Monitor does the same. A new season adds its row.
 */
export const BONUS_RP: Record<number, { label: string; field: string }[]> = {
  2023: [
    { label: "Sustainability Bonus", field: "sustainabilityBonusAchieved" },
    { label: "Activation Bonus", field: "activationBonusAchieved" },
  ],
  2024: [
    { label: "Melody Bonus", field: "melodyBonusAchieved" },
    { label: "Ensemble Bonus", field: "ensembleBonusAchieved" },
  ],
  2025: [
    { label: "Auto Bonus", field: "autoBonusAchieved" },
    { label: "Coral Bonus", field: "coralBonusAchieved" },
    { label: "Barge Bonus", field: "bargeBonusAchieved" },
  ],
  2026: [
    { label: "Energized Bonus", field: "energizedAchieved" },
    { label: "Supercharged Bonus", field: "superchargedAchieved" },
    { label: "Traversal Bonus", field: "traversalAchieved" },
  ],
};

/** A played qualification match's bonus ranking points, or null when there's nothing to show. */
function tbaBonusRp(match: TbaMatch): BonusRp | null {
  const season = BONUS_RP[Number(match.key?.slice(0, 4))];
  const { red, blue } = match.score_breakdown ?? {};
  if (match.comp_level !== "qm" || !season || !red || !blue) return null;
  return {
    labels: season.map((rp) => rp.label),
    red: season.map((rp) => red[rp.field] === true),
    blue: season.map((rp) => blue[rp.field] === true),
  };
}

/** Where Nexus says a match is. A match that's been played stays "On field". */
export type NexusStatus = "Queuing soon" | "Now queuing" | "On deck" | "On field";

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
  return { red, blue, winner, bonus: tbaBonusRp(match) };
}

/** When a Blue Alliance match starts (predicted, else scheduled) and queues, in ms. */
function tbaTimes(match: TbaMatch): MonitorScheduleMatch["times"] {
  return {
    estimatedStartTime: match.predicted_time
      ? match.predicted_time * 1000
      : match.time
        ? match.time * 1000
        : null,
    // About 5 minutes before it starts.
    estimatedQueueTime: match.predicted_time ? (match.predicted_time - 300) * 1000 : null,
  };
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
      times: tbaTimes(match),
      result: tbaResult(match),
    }))
    .sort((a, b) => (a.times.estimatedStartTime ?? 0) - (b.times.estimatedStartTime ?? 0));
}

type NexusMatch = {
  label?: unknown;
  status?: unknown;
  redTeams?: unknown;
  blueTeams?: unknown;
  times?: Record<string, unknown> | null;
  result?: MatchResult | null;
  /** Its times are The Blue Alliance's: Nexus had none. */
  timesFromTba?: boolean;
};

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
 * 12" is qm12) and checked by who's playing. A match Nexus has no times for takes The Blue
 * Alliance's, marked `timesFromTba`.
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
    const same = tba && sameAlliances(match, tba) ? tba : null;
    const times = match.times ?? {};
    const timed = Boolean(times.estimatedQueueTime || times.estimatedStartTime);
    const tbaTimed = same && !timed ? tbaTimes(same) : null;
    return {
      ...match,
      ...(tbaTimed?.estimatedStartTime
        ? { times: { ...times, ...tbaTimed }, timesFromTba: true }
        : {}),
      result: same ? tbaResult(same) : null,
    };
  });
}

/** The team's next match, for the Monitor's "Our next match". */
export interface OurNextMatch {
  label: string;
  alliance: "red" | "blue";
  /** Each alliance's teams by driver station (1, 2, 3); "" for one not known yet. */
  redTeams: string[];
  blueTeams: string[];
  /** Where Nexus says it is; null on The Blue Alliance's schedule, which doesn't say. */
  status: NexusStatus | null;
  /**
   * Matches to go until it's called to queue (1: it's the next one called), while Nexus has it
   * "Queuing soon"; null once it's been called, and on The Blue Alliance's schedule.
   */
  matchesUntilQueuing: number | null;
  /** Matches to go until it's on the field: 0 while it is. */
  matchesUntilField: number;
  /** When it was called to queue (`queued`), else when it's expected to be. In ms, like the rest. */
  queueTime: number | null;
  queued: boolean;
  onFieldTime: number | null;
  startTime: number | null;
  /** Whose times they are. */
  timesFrom: "nexus" | "tba";
}

/** The team's next match (null when it has none to come), and how many matches it has in all. */
export type OurSchedule = { next: OurNextMatch | null; total: number };

const STEPS: NexusStatus[] = ["Queuing soon", "Now queuing", "On deck", "On field"];

const teamList = (teams: unknown) =>
  Array.isArray(teams) ? teams.filter((team) => team != null && team !== "").map(String) : [];

/** An alliance's teams by station, keeping a place for one not known yet. */
const stations = (teams: unknown) =>
  Array.isArray(teams) ? teams.map((team) => (team == null ? "" : String(team))) : [];

const msOrNull = (value: unknown) => (typeof value === "number" && value > 0 ? value : null);

/**
 * The team's next match from the Monitor's schedule (in order), and how far off it is.
 *
 * With Nexus, the event is at its last match "On field": a match of ours before it is over even
 * while its score isn't in yet. Ours is called to queue once every match before it has been
 * (the last one Nexus has past "Queuing soon"). On The Blue Alliance's schedule, which says
 * nothing about queuing, the event is at the match after the last one with a score.
 */
export function ourSchedule(
  matches: unknown[],
  teamNumber: string,
  fromNexus: boolean,
): OurSchedule {
  const list = matches.map((raw) => (raw ?? {}) as NexusMatch);
  const statusOf = (match: NexusMatch) =>
    fromNexus ? STEPS.indexOf(match.status as NexusStatus) : -1;
  const lastIndex = (test: (match: NexusMatch) => boolean) => {
    for (let index = list.length - 1; index >= 0; index--) if (test(list[index])) return index;
    return -1;
  };

  // The match on the field now, or -1 before the first.
  const onField = fromNexus
    ? lastIndex((match) => statusOf(match) === 3)
    : lastIndex((match) => !!match.result) + 1;
  // The last match called to queue.
  const called = fromNexus ? lastIndex((match) => statusOf(match) >= 1) : -1;

  const ours = list.flatMap(
    (match, index): { match: NexusMatch; index: number; alliance: "red" | "blue" }[] => {
      const red = teamList(match.redTeams);
      const blue = teamList(match.blueTeams);
      if (red.includes(teamNumber)) return [{ match, index, alliance: "red" }];
      if (blue.includes(teamNumber)) return [{ match, index, alliance: "blue" }];
      return [];
    },
  );
  const found = ours.find(({ match, index }) => !match.result && index >= onField);
  if (!found) return { next: null, total: ours.length };

  const { match, index, alliance } = found;
  const step = statusOf(match);
  const times = match.times ?? {};
  const actualQueue = msOrNull(times.actualQueueTime);
  return {
    total: ours.length,
    next: {
      label: typeof match.label === "string" ? match.label : "",
      alliance,
      redTeams: stations(match.redTeams),
      blueTeams: stations(match.blueTeams),
      status: step >= 0 ? STEPS[step] : null,
      matchesUntilQueuing: fromNexus && step <= 0 ? Math.max(1, index - called) : null,
      matchesUntilField: index - onField,
      queueTime: actualQueue ?? msOrNull(times.estimatedQueueTime),
      queued: actualQueue !== null,
      onFieldTime: msOrNull(times.actualOnFieldTime) ?? msOrNull(times.estimatedOnFieldTime),
      startTime: msOrNull(times.estimatedStartTime),
      timesFrom: fromNexus && !match.timesFromTba ? "nexus" : "tba",
    },
  };
}

export type RankingInfo = { rank: number; team: string };

/**
 * The top 3 and the three teams "around us": #4–6 for a top-3 team, three below for #4, a mix for
 * #5 and #6 (so they don't repeat the top 3), else the three just above.
 */
export function contextRankingsFor(
  rankings: RankingInfo[],
  ourRank: number,
): { top3: RankingInfo[]; context: RankingInfo[] } {
  const near =
    ourRank <= 3
      ? [4, 5, 6]
      : ourRank === 4
        ? [5, 6, 7]
        : ourRank === 5
          ? [4, 6, 7]
          : ourRank === 6
            ? [4, 5, 7]
            : [ourRank - 3, ourRank - 2, ourRank - 1];
  return {
    top3: rankings.slice(0, 3),
    context: near.flatMap((rank) => rankings.find((r) => r.rank === rank) ?? []),
  };
}
