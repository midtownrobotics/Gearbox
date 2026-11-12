// SPDX-License-Identifier: AGPL-3.0-only
import { demoTeamId, teamHostLabel, teamOfHostLabel } from "@g3/site-config";
import { sharedCookieAttributes } from "./shared-cookie";

// The team this browser last opened: its home (Portal) remembers it, and the platform's public
// site offers it as "My team". Only the team's address label ("1648", "ftc12345"), never who's
// signed in; a team that's gone is forgotten when its address says so (the platform's
// team-not-found page). The public demo is never remembered: a visitor trying it isn't on that
// team. A cookie saved before FTC teams could sign up holds a plain number: an FRC team.

const COOKIE = "g3_team";
const YEAR_S = 365 * 24 * 60 * 60;

/** The remembered team's id ("frc1648", "ftc12345"), or null. */
export function rememberedTeam(): string | null {
  const saved = document.cookie.match(/(?:^|;\s*)g3_team=((?:ftc)?\d{1,5})(?:;|$)/)?.[1];
  const team = saved ? teamOfHostLabel(saved) : null;
  return team && team !== demoTeamId ? team : null;
}

export function rememberTeam(teamId: string) {
  if (teamId === demoTeamId) return;
  document.cookie = `${COOKIE}=${teamHostLabel(teamId)}; ${sharedCookieAttributes(YEAR_S)}`;
}

export function forgetTeam() {
  document.cookie = `${COOKIE}=; ${sharedCookieAttributes(0)}`;
}
