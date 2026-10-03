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

export {
  type G3AuthEnv,
  type G3AuthVariables,
  hasMentorAccess,
  requireAdmin,
  requireAuth,
  requireAuthWithIdentities,
  requireMentor,
  requireOAuthSession,
} from "./g3id";
