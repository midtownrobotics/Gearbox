import type { TbaMatch } from "./types";
import { finiteNumber } from "./utils";

export const DEFAULT_SUBMISSION_WINDOW = 120;
export const MIN_SUBMISSION_WINDOW = 0;
export const MAX_SUBMISSION_WINDOW = 1800;

export function submissionWindow(value: unknown) {
  const seconds = finiteNumber(value);
  return seconds !== null &&
    Number.isInteger(seconds) &&
    seconds >= 0 &&
    seconds <= MAX_SUBMISSION_WINDOW
    ? seconds
    : null;
}

/**
 * How long after a match moves on a scout can still send their report for it. The report lands on
 * the match it was written for and is marked late, so nothing a scout wrote is thrown away.
 */
export const DEFAULT_LATE_WINDOW = 600;
export const MAX_LATE_WINDOW = 3600;

export function lateWindow(value: unknown) {
  const seconds = finiteNumber(value);
  return seconds !== null && Number.isInteger(seconds) && seconds >= 0 && seconds <= MAX_LATE_WINDOW
    ? seconds
    : null;
}

export function matchOrder(match: TbaMatch) {
  const level = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 }[match.comp_level] ?? 5;
  return level * 100_000 + match.set_number * 1_000 + match.match_number;
}

export function matchSubmissionClosesAt(
  match: TbaMatch | undefined,
  windowSeconds = DEFAULT_SUBMISSION_WINDOW,
) {
  if (!match) return null;
  const hasResult = match.alliances.red.score >= 0 && match.alliances.blue.score >= 0;
  const endedAt =
    match.post_result_time ??
    (match.actual_time ? match.actual_time + 150 : null) ??
    (hasResult ? (match.predicted_time ?? match.time ?? 0) + 150 : null);
  return endedAt ? (endedAt + windowSeconds) * 1000 : null;
}

export function automaticTbaMatch(
  matches: TbaMatch[],
  windowSeconds = DEFAULT_SUBMISSION_WINDOW,
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
    const closesAt = matchSubmissionClosesAt(match, windowSeconds);
    if (closesAt === null || now * 1000 < closesAt) return match;
  }
  return ordered.at(-1);
}

/**
 * The match a scout moves to once their report for `held` is in. The window after a match keeps
 * everyone on it so a late report still lands on the right match, but a scout who has already
 * sent theirs has nothing left to wait for, and waiting the window out would put them on the
 * match in front of them late. Returns `held` while nothing has started after it.
 */
export function matchAfterSubmitting(
  matches: TbaMatch[],
  held: TbaMatch | undefined,
  now = Math.floor(Date.now() / 1000),
) {
  if (!held) return held;
  const next = automaticTbaMatch(matches, 0, now);
  return next && next.key !== held.key ? next : held;
}
