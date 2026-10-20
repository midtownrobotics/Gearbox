/**
 * Playoff brackets for playoff scouting: FRC's double elimination brackets and round robins,
 * which match feeds which, and, from the results chosen so far, which alliances meet in each
 * match. Nothing here touches the database; `playoffs.ts` stores the results and asks this for
 * the rest.
 */

export type BracketFormat = "double8" | "double4" | "roundrobin6" | "roundrobin4";
export type Side = "red" | "blue";
/** A match's result: a side won, or (in a round robin only) it was a tie. */
export type Result = Side | "tie";

/** Where an alliance in a match comes from: its seed, or the winner or loser of an earlier match. */
type Source = { seed: number } | { winner: string } | { loser: string };

type Stage = "upper" | "lower" | "roundrobin" | "finals";

type MatchDefinition = { id: string; round: string; bracket: Stage; red: Source; blue: Source };

type FormatDefinition = {
  label: string;
  alliances: number;
  matches: MatchDefinition[];
  /**
   * Who meets in the best-of-three finals: the winners of two matches (double elimination), or
   * the top two of the round robin's standings.
   */
  finals: [string, string] | "standings";
};

const seed = (n: number): Source => ({ seed: n });
const won = (id: string): Source => ({ winner: id });
const lost = (id: string): Source => ({ loser: id });

/**
 * Every alliance plays every other once, by the circle method: one match each per round, so
 * nobody plays twice in a row, and every alliance red within one match of half the time.
 */
function roundRobin(alliances: number): MatchDefinition[] {
  const order = Array.from({ length: alliances }, (_, index) => index + 1);
  const matches: MatchDefinition[] = [];
  for (let round = 0; round < alliances - 1; round += 1) {
    for (let index = 0; index < alliances / 2; index += 1) {
      const pair = [order[index], order[alliances - 1 - index]];
      // The alliance that stays put changes color each round; the others by place in the circle.
      const first = index === 0 ? round % 2 === 0 : index % 2 === 0;
      const [red, blue] = first ? pair : [pair[1], pair[0]];
      matches.push({
        id: `M${matches.length + 1}`,
        round: `Round ${round + 1}`,
        bracket: "roundrobin",
        red: seed(red),
        blue: seed(blue),
      });
    }
    order.splice(1, 0, order.pop() as number);
  }
  return matches;
}

/** FRC's brackets, in the order the matches are played. */
export const FORMATS: Record<BracketFormat, FormatDefinition> = {
  double8: {
    label: "8 alliances, double elimination",
    alliances: 8,
    matches: [
      { id: "M1", round: "Round 1", bracket: "upper", red: seed(1), blue: seed(8) },
      { id: "M2", round: "Round 1", bracket: "upper", red: seed(4), blue: seed(5) },
      { id: "M3", round: "Round 1", bracket: "upper", red: seed(2), blue: seed(7) },
      { id: "M4", round: "Round 1", bracket: "upper", red: seed(3), blue: seed(6) },
      { id: "M5", round: "Round 2", bracket: "lower", red: lost("M1"), blue: lost("M2") },
      { id: "M6", round: "Round 2", bracket: "lower", red: lost("M3"), blue: lost("M4") },
      { id: "M7", round: "Round 2", bracket: "upper", red: won("M1"), blue: won("M2") },
      { id: "M8", round: "Round 2", bracket: "upper", red: won("M3"), blue: won("M4") },
      { id: "M9", round: "Round 3", bracket: "lower", red: lost("M7"), blue: won("M6") },
      { id: "M10", round: "Round 3", bracket: "lower", red: lost("M8"), blue: won("M5") },
      { id: "M11", round: "Round 4", bracket: "upper", red: won("M7"), blue: won("M8") },
      { id: "M12", round: "Round 4", bracket: "lower", red: won("M10"), blue: won("M9") },
      { id: "M13", round: "Round 5", bracket: "lower", red: lost("M11"), blue: won("M12") },
    ],
    finals: ["M11", "M13"],
  },
  double4: {
    label: "4 alliances, double elimination",
    alliances: 4,
    matches: [
      { id: "M1", round: "Round 1", bracket: "upper", red: seed(1), blue: seed(4) },
      { id: "M2", round: "Round 1", bracket: "upper", red: seed(2), blue: seed(3) },
      { id: "M3", round: "Round 2", bracket: "lower", red: lost("M1"), blue: lost("M2") },
      { id: "M4", round: "Round 2", bracket: "upper", red: won("M1"), blue: won("M2") },
      { id: "M5", round: "Round 3", bracket: "lower", red: lost("M4"), blue: won("M3") },
    ],
    finals: ["M4", "M5"],
  },
  roundrobin6: {
    label: "6 alliances, round robin",
    alliances: 6,
    matches: roundRobin(6),
    finals: "standings",
  },
  roundrobin4: {
    label: "4 alliances, round robin",
    alliances: 4,
    matches: roundRobin(4),
    finals: "standings",
  },
};

export const FINALS = ["F1", "F2", "F3"] as const;

export function isFormat(value: unknown): value is BracketFormat {
  return typeof value === "string" && value in FORMATS;
}

export const isRoundRobin = (format: BracketFormat) => FORMATS[format].finals === "standings";

export type BracketMatch = {
  id: string;
  label: string;
  round: string;
  bracket: Stage;
  /** The alliances' seeds, once the matches before have been decided. */
  red: number | null;
  blue: number | null;
  /** Where each alliance comes from, for a match whose alliances aren't known yet. */
  redFrom: string;
  blueFrom: string;
  winner: Result | null;
  /** False for a third final that won't be played: one alliance has already won two. */
  needed: boolean;
};

/** An alliance's round robin record: 2 points a win, 1 a tie. */
export type Standing = {
  seed: number;
  wins: number;
  losses: number;
  ties: number;
  points: number;
};

function describe(source: Source) {
  if ("seed" in source) return `Alliance ${source.seed}`;
  if ("winner" in source) return `Winner of ${matchLabel(source.winner)}`;
  return `Loser of ${matchLabel(source.loser)}`;
}

export function matchLabel(id: string) {
  return id.startsWith("F") ? `Final ${id.slice(1)}` : `Match ${id.slice(1)}`;
}

/** Every match id in the format, in the order played. */
export function matchIds(format: BracketFormat) {
  return [...FORMATS[format].matches.map((match) => match.id), ...FINALS];
}

/** The round robin's standings, most points first (seed breaks a tie, only for showing them). */
export function standings(format: BracketFormat, bracket: BracketMatch[]): Standing[] {
  if (!isRoundRobin(format)) return [];
  const table = new Map<number, Standing>(
    Array.from({ length: FORMATS[format].alliances }, (_, index) => [
      index + 1,
      { seed: index + 1, wins: 0, losses: 0, ties: 0, points: 0 },
    ]),
  );
  for (const match of bracket) {
    if (match.bracket !== "roundrobin" || !match.winner || !match.red || !match.blue) continue;
    const red = table.get(match.red) as Standing;
    const blue = table.get(match.blue) as Standing;
    if (match.winner === "tie") {
      red.ties += 1;
      blue.ties += 1;
    } else {
      const [winner, loser] = match.winner === "red" ? [red, blue] : [blue, red];
      winner.wins += 1;
      loser.losses += 1;
    }
  }
  return Array.from(table.values())
    .map((row) => ({ ...row, points: row.wins * 2 + row.ties }))
    .sort((a, b) => b.points - a.points || a.seed - b.seed);
}

/**
 * The round robin's finalists, higher ranked first (red): the ones chosen, else the top two once
 * every round robin match has a result and nobody is level on points with second place. Null
 * while that's still open: a strategy lead chooses them.
 */
export function roundRobinFinalists(
  format: BracketFormat,
  bracket: BracketMatch[],
  chosen: [number, number] | null,
): [number, number] | null {
  const played = bracket.filter((match) => match.bracket === "roundrobin");
  if (!played.length || played.some((match) => !match.winner)) return null;
  if (chosen) return chosen;
  const table = standings(format, bracket);
  if (table.length > 2 && table[1].points === table[2].points) return null;
  return [table[0].seed, table[1].seed];
}

/**
 * The bracket as it stands: each match's alliances from the results chosen so far. A result
 * recorded for a match whose alliances aren't known (which the routes never store), or a tie
 * outside a round robin, is ignored. `finalists` are a round robin's chosen finalists.
 */
export function resolveBracket(
  format: BracketFormat,
  results: Record<string, Result | null | undefined>,
  finalists: [number, number] | null = null,
): BracketMatch[] {
  const definition = FORMATS[format];
  const outcomes = new Map<string, { winner: number; loser: number }>();
  const resolve = (source: Source) => {
    if ("seed" in source) return source.seed;
    const outcome = outcomes.get("winner" in source ? source.winner : source.loser);
    if (!outcome) return null;
    return "winner" in source ? outcome.winner : outcome.loser;
  };
  const out: BracketMatch[] = [];
  const decide = (match: BracketMatch) => {
    const result = results[match.id];
    if (!match.red || !match.blue || !match.needed) return;
    if (result === "tie" && match.bracket === "roundrobin") match.winner = "tie";
    if (result === "red" || result === "blue") {
      match.winner = result;
      outcomes.set(match.id, {
        winner: result === "red" ? match.red : match.blue,
        loser: result === "red" ? match.blue : match.red,
      });
    }
  };
  for (const match of definition.matches) {
    const resolved: BracketMatch = {
      id: match.id,
      label: matchLabel(match.id),
      round: match.round,
      bracket: match.bracket,
      red: resolve(match.red),
      blue: resolve(match.blue),
      redFrom: describe(match.red),
      blueFrom: describe(match.blue),
      winner: null,
      needed: true,
    };
    decide(resolved);
    out.push(resolved);
  }
  let red: number | null;
  let blue: number | null;
  let redFrom: string;
  let blueFrom: string;
  if (definition.finals === "standings") {
    [red, blue] = roundRobinFinalists(format, out, finalists) ?? [null, null];
    [redFrom, blueFrom] = ["Round robin first", "Round robin second"];
  } else {
    const [redFinalist, blueFinalist] = definition.finals;
    red = outcomes.get(redFinalist)?.winner ?? null;
    blue = outcomes.get(blueFinalist)?.winner ?? null;
    [redFrom, blueFrom] = [
      `Winner of ${matchLabel(redFinalist)}`,
      `Winner of ${matchLabel(blueFinalist)}`,
    ];
  }
  const wins: Record<Side, number> = { red: 0, blue: 0 };
  for (const id of FINALS) {
    const final: BracketMatch = {
      id,
      label: matchLabel(id),
      round: "Finals",
      bracket: "finals",
      red,
      blue,
      redFrom,
      blueFrom,
      winner: null,
      // Best of three: a final is played only while neither alliance has won two.
      needed: wins.red < 2 && wins.blue < 2,
    };
    decide(final);
    if (final.winner === "red" || final.winner === "blue") wins[final.winner] += 1;
    out.push(final);
  }
  return out;
}

/** The seed of the alliance that won the playoffs, once it has. */
export function champion(bracket: BracketMatch[]) {
  const finals = bracket.filter((match) => match.bracket === "finals");
  for (const side of ["red", "blue"] as const)
    if (finals.filter((match) => match.winner === side).length >= 2) return finals[0][side];
  return null;
}

/** The first match still to be decided whose alliances are both known. */
export function nextMatch(bracket: BracketMatch[]) {
  return bracket.find((match) => match.needed && !match.winner && match.red && match.blue) ?? null;
}

/** True once a round robin is over and its finalists are still to be chosen. */
export function needsFinalists(format: BracketFormat, bracket: BracketMatch[]) {
  if (!isRoundRobin(format)) return false;
  const played = bracket.filter((match) => match.bracket === "roundrobin");
  const finals = bracket.find((match) => match.bracket === "finals");
  return played.every((match) => match.winner) && !finals?.red;
}

/**
 * The matches whose alliances depend on this one's result: those fed by its winner or loser,
 * and, for a final, the finals after it (whether they're played depends on it). Every round
 * robin result can change who's in the finals.
 */
export function dependents(format: BracketFormat, id: string): string[] {
  const definition = FORMATS[format];
  const fedBy = (source: Source) =>
    ("winner" in source && source.winner === id) || ("loser" in source && source.loser === id);
  const direct = definition.matches
    .filter((match) => fedBy(match.red) || fedBy(match.blue))
    .map((match) => match.id);
  if (
    definition.finals === "standings"
      ? !id.startsWith("F")
      : (definition.finals as string[]).includes(id)
  )
    direct.push(...FINALS);
  if (id.startsWith("F")) direct.push(...FINALS.filter((final) => final > id));
  const all = new Set<string>();
  for (const next of direct) {
    all.add(next);
    for (const later of dependents(format, next)) all.add(later);
  }
  return Array.from(all);
}
