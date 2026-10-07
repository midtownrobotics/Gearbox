// A team's members with their roles, and messages to them on the team's Slack, from G3ID over the
// service binding (its /api/internal routes are never reachable through the gateway). Apps keep no
// list of people of their own, and never hold a team's Slack token.

export type Member = {
  id: string;
  displayName: string;
  email: string;
  status: "pending" | "active" | "rejected" | "merged";
  isAdmin: boolean;
  isMentor: boolean;
};

/** The team's members (any status), or null when G3ID can't be reached. */
export async function teamMembers(
  env: { G3ID: Fetcher },
  teamId: string,
): Promise<Member[] | null> {
  const res = await env.G3ID.fetch(
    new Request(`http://g3id/api/internal/teams/${encodeURIComponent(teamId)}/members`),
  );
  if (!res.ok) return null;
  return (await res.json()) as Member[];
}

/** The team's active members. */
export async function activeMembers(env: { G3ID: Fetcher }, teamId: string) {
  return (await teamMembers(env, teamId))?.filter((m) => m.status === "active") ?? null;
}

/**
 * Sends a Slack direct message from the team's own bot. Returns false when it wasn't sent (the
 * team hasn't connected Slack, or Slack refused); it never throws for that, so callers can fire
 * and forget.
 */
export async function sendTeamDM(
  env: { G3ID: Fetcher },
  teamId: string,
  slackUserId: string,
  text: string,
): Promise<boolean> {
  const res = await env.G3ID.fetch(
    new Request(`http://g3id/api/internal/teams/${encodeURIComponent(teamId)}/slack/dm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slackUserId, text }),
    }),
  );
  if (!res.ok && res.status !== 404) {
    console.error("[slack] team DM failed", res.status, await res.text().catch(() => ""));
  }
  return res.ok;
}
