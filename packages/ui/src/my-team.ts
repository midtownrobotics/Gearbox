import { sharedCookieAttributes } from "./shared-cookie";

// The team this browser last opened: its home (Portal) remembers it, and the platform's public
// site offers it as "My team". Only a number, never who's signed in; a team that's gone is
// forgotten when its address says so (the platform's team-not-found page).

const COOKIE = "g3_team";
const YEAR_S = 365 * 24 * 60 * 60;

/** The remembered team's FRC number, or null. */
export function rememberedTeam(): number | null {
  const saved = document.cookie.match(/(?:^|;\s*)g3_team=(\d{1,5})(?:;|$)/)?.[1];
  return saved ? Number(saved) : null;
}

export function rememberTeam(teamNumber: number) {
  document.cookie = `${COOKIE}=${teamNumber}; ${sharedCookieAttributes(YEAR_S)}`;
}

export function forgetTeam() {
  document.cookie = `${COOKIE}=; ${sharedCookieAttributes(0)}`;
}
