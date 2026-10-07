// A team's members with their roles, from G3ID over the service binding (its /api/internal routes
// are never reachable through the gateway). Apps keep no list of people of their own.

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
