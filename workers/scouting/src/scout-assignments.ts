/** Interleave alliances and rotate the first choice each match, rather than always starting red. */
export function assignmentCandidates(teams: string[], matchNumber: number) {
  const unique = [...new Set(teams)];
  const half = Math.ceil(unique.length / 2);
  const interleaved = unique
    .slice(0, half)
    .flatMap((team, index) => (unique[index + half] ? [team, unique[index + half]] : [team]));
  const start = Math.max(0, matchNumber - 1) % (interleaved.length || 1);
  return [...interleaved.slice(start), ...interleaved.slice(0, start)];
}
