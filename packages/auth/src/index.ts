import { TEAM_HEADER } from "./g3id";

export interface SessionBindings {
  SESSIONS: KVNamespace;
}

export function getSessionIds(cookieHeader: string): string[] {
  return cookieHeader
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("g3_session="))
    .map((p) => p.slice("g3_session=".length))
    .filter(Boolean);
}

export async function resolveUserId(
  cookieHeader: string,
  env: SessionBindings,
): Promise<string | null> {
  for (const id of getSessionIds(cookieHeader)) {
    const userId = await env.SESSIONS.get(`session:${id}`);
    if (userId) return userId;
  }
  return null;
}

export { type Member, activeMembers, sendTeamDM, teamMembers } from "./members";
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

export {
  type G3AuthEnv,
  type G3AuthVariables,
  hasMentorAccess,
  requireAdmin,
  requireAuth,
  requireAuthWithIdentities,
  requireMentor,
  requireOAuthSession,
  requestTeamId,
  TEAM_HEADER,
} from "./g3id";
