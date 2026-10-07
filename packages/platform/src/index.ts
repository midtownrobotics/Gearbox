// The platform SDK (roadmap Phase 3): what an app needs to serve many teams from one deployment.
// Sign-in, roles and the request's team come from @g3/auth (`c.get("teamId")` after requireAuth).

import { TEAM_HEADER } from "@g3/auth";

export { requestTeamId, TEAM_HEADER } from "@g3/auth";
export { type Member, activeMembers, teamMembers } from "./members";
export { inTeam, withTeam } from "./scope";

/**
 * Headers for calling another app's worker as the signed-in user (a service binding skips the
 * gateway): their session cookie and the request's team, so the other app signs them in to the
 * same team.
 */
export function forwardIdentity(c: {
  req: { header(name: string): string | undefined };
}): Record<string, string> {
  const headers: Record<string, string> = { Cookie: c.req.header("Cookie") ?? "" };
  const team = c.req.header(TEAM_HEADER);
  if (team) headers[TEAM_HEADER] = team;
  return headers;
}
