import type { TbaMatch } from "./types";
import { finiteNumber } from "./utils";

export const DEFAULT_AUTO_ADVANCE_DELAY_MINUTES = 2;
export const MAX_AUTO_ADVANCE_DELAY_MINUTES = 30;

export function parseAutoAdvanceDelay(value: unknown) {
  const minutes = finiteNumber(value);
  return minutes !== null &&
    Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= MAX_AUTO_ADVANCE_DELAY_MINUTES
    ? minutes
    : null;
}

export function matchOrder(match: TbaMatch) {
  const level = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 }[match.comp_level] ?? 5;
  return level * 100_000 + match.set_number * 1_000 + match.match_number;
}

export function automaticTbaMatch(
  matches: TbaMatch[],
  delayMinutes = DEFAULT_AUTO_ADVANCE_DELAY_MINUTES,
  now = Math.floor(Date.now() / 1000),
) {
  const qualifications = matches
    .filter((match) => match.comp_level === "qm")
    .sort((left, right) => matchOrder(left) - matchOrder(right));
  const ordered = qualifications.length
    ? qualifications
    : [...matches].sort((left, right) => matchOrder(left) - matchOrder(right));
  if (!ordered.length) return undefined;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const match = ordered[index];
    const hasResult = match.alliances.red.score >= 0 && match.alliances.blue.score >= 0;
    const endedAt =
      match.post_result_time ??
      (match.actual_time ? match.actual_time + 150 : null) ??
      (hasResult ? (match.predicted_time ?? match.time ?? 0) + 150 : null);
    if (!endedAt || now < endedAt + delayMinutes * 60) return match;
  }
  return ordered.at(-1);
}
