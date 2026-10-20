/**
 * Playoff brackets for playoff scouting: FRC's double elimination brackets, which match feeds
 * which, and, from the winners chosen so far, which alliances meet in each match. Nothing here
 * touches the database; `playoffs.ts` stores the winners and asks this for the rest.
 */

export type BracketFormat = "double8" | "double4";
export type Side = "red" | "blue";

/** Where an alliance in a match comes from: its seed, or the winner or loser of an earlier match. */
type Source = { seed: number } | { winner: string } | { loser: string };

type MatchDefinition = {
  id: string;
  round: string;
  /** Upper (winners') or lower (losers') bracket, or the finals. */
  bracket: "upper" | "lower" | "finals";
  red: Source;
  blue: Source;
};

type FormatDefinition = {
  label: string;
  alliances: number;
  matches: MatchDefinition[];
  /** The matches whose winners meet in the best-of-three finals: red, then blue. */
  finals: [string, string];
};

const seed = (n: number): Source => ({ seed: n });
const won = (id: string): Source => ({ winner: id });
const lost = (id: string): Source => ({ loser: id });

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
};

export const FINALS = ["F1", "F2", "F3"] as const;

export function isFormat(value: unknown): value is BracketFormat {
  return typeof value === "string" && value in FORMATS;
}

export type BracketMatch = {
  id: string;
  label: string;
  round: string;
  bracket: "upper" | "lower" | "finals";
  /** The alliances' seeds, once the matches before have been decided. */
  red: number | null;
  blue: number | null;
  /** Where each alliance comes from, for a match whose alliances aren't known yet. */
  redFrom: string;
  blueFrom: string;
  winner: Side | null;
  /** False for a third final that won't be played: one alliance has already won two. */
  needed: boolean;
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

/**
 * The bracket as it stands: each match's alliances from the winners chosen so far. A winner
 * recorded for a match whose alliances aren't known (which the routes never store) is ignored.
 */
export function resolveBracket(
  format: BracketFormat,
  winners: Record<string, Side | null | undefined>,
): BracketMatch[] {
  const definition = FORMATS[format];
  const results = new Map<string, { winner: number; loser: number }>();
  const resolve = (source: Source) => {
    if ("seed" in source) return source.seed;
    const result = results.get("winner" in source ? source.winner : source.loser);
    if (!result) return null;
    return "winner" in source ? result.winner : result.loser;
  };
  const out: BracketMatch[] = [];
  const decide = (match: BracketMatch) => {
    const winner = winners[match.id];
    if ((winner === "red" || winner === "blue") && match.red && match.blue && match.needed) {
      match.winner = winner;
      results.set(match.id, {
        winner: winner === "red" ? match.red : match.blue,
        loser: winner === "red" ? match.blue : match.red,
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
  const [redFinalist, blueFinalist] = definition.finals;
  const red = results.get(redFinalist)?.winner ?? null;
  const blue = results.get(blueFinalist)?.winner ?? null;
  const wins: Record<Side, number> = { red: 0, blue: 0 };
  for (const id of FINALS) {
    const final: BracketMatch = {
      id,
      label: matchLabel(id),
      round: "Finals",
      bracket: "finals",
      red,
      blue,
      redFrom: `Winner of ${matchLabel(redFinalist)}`,
      blueFrom: `Winner of ${matchLabel(blueFinalist)}`,
      winner: null,
      // Best of three: a final is played only while neither alliance has won two.
      needed: wins.red < 2 && wins.blue < 2,
    };
    decide(final);
    if (final.winner) wins[final.winner] += 1;
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

/**
 * The matches whose alliances depend on this one's result: those fed by its winner or loser,
 * and, for a final, the finals after it (whether they're played depends on it).
 */
export function dependents(format: BracketFormat, id: string): string[] {
  const definition = FORMATS[format];
  const fedBy = (source: Source) =>
    ("winner" in source && source.winner === id) || ("loser" in source && source.loser === id);
  const direct = definition.matches
    .filter((match) => fedBy(match.red) || fedBy(match.blue))
    .map((match) => match.id);
  if (definition.finals.includes(id)) direct.push(...FINALS);
  if (id.startsWith("F")) direct.push(...FINALS.filter((final) => final > id));
  const all = new Set<string>();
  for (const next of direct) {
    all.add(next);
    for (const later of dependents(format, next)) all.add(later);
  }
  return Array.from(all);
}
