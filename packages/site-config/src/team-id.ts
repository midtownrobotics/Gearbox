// SPDX-License-Identifier: AGPL-3.0-only

// A team's id is its program and its number, as FIRST's sites write them: "frc1648", "ftc12345".
// FRC and FTC number their teams separately, so FRC 254 and FTC 254 are two teams. Every app keys
// a team's data by this id. On the platform's domain an FRC team's addresses are its number
// (1648-orders.<platform>) and an FTC team's start with "ftc" (ftc12345-orders.<platform>).

/** The FIRST programs a team can be in. */
export const PROGRAMS = ["frc", "ftc"] as const;
export type Program = (typeof PROGRAMS)[number];

/** How pages name each program. */
export const programNames: Record<Program, string> = { frc: "FRC", ftc: "FTC" };

export function isProgram(value: unknown): value is Program {
  return value === "frc" || value === "ftc";
}

/** The team's id: "frc1648", "ftc12345". */
export function teamIdFor(program: Program, teamNumber: number): string {
  return `${program}${teamNumber}`;
}

/** A team id's program and number, or null for anything else. */
export function parseTeamId(teamId: string): { program: Program; number: number } | null {
  const match = teamId.match(/^(frc|ftc)([1-9]\d*)$/);
  return match ? { program: match[1] as Program, number: Number(match[2]) } : null;
}

/** A team id's number (1648 for "frc1648"); NaN for anything else. */
export function teamNumberOf(teamId: string): number {
  return parseTeamId(teamId)?.number ?? Number.NaN;
}

/** A team id's program; FRC for anything else (every team before FTC teams could sign up). */
export function teamProgramOf(teamId: string): Program {
  return parseTeamId(teamId)?.program ?? "frc";
}

/**
 * The team's part of its addresses: its number for an FRC team ("1648", as in 1648-orders), "ftc"
 * and its number for an FTC team ("ftc12345").
 */
export function teamHostLabel(teamId: string): string {
  const team = parseTeamId(teamId);
  if (!team) return teamId;
  return team.program === "frc" ? String(team.number) : teamId;
}

/** The team a host label names ("1648" → "frc1648", "ftc12345" → "ftc12345"), or null. */
export function teamOfHostLabel(label: string): string | null {
  const match = label.match(/^(ftc)?([1-9]\d*)$/);
  return match ? teamIdFor(match[1] ? "ftc" : "frc", Number(match[2])) : null;
}

/** How pages name a team by its number: "Team 1648", "FTC Team 12345". */
export function teamLabel(teamId: string): string {
  const team = parseTeamId(teamId);
  if (!team) return teamId;
  return team.program === "frc" ? `Team ${team.number}` : `FTC Team ${team.number}`;
}

/** A team's number as pages write it beside its name: "1648", "FTC 12345". */
export function teamNumberLabel(teamId: string): string {
  const team = parseTeamId(teamId);
  if (!team) return teamId;
  return team.program === "frc" ? String(team.number) : `FTC ${team.number}`;
}
