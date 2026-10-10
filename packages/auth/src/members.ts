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

/**
 * Posts to one of the team's Slack channels from its own bot. Never throws: gives back why it
 * wasn't posted (the team has no Slack, or Slack's refusal, like "not_in_channel").
 */
export async function sendTeamMessage(
  env: { G3ID: Fetcher },
  teamId: string,
  channel: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await env.G3ID.fetch(
      new Request(`http://g3id/api/internal/teams/${encodeURIComponent(teamId)}/slack/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, text }),
      }),
    );
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `G3ID answered ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Whether the team has an app on (the platform's app library, through G3ID): null when that can't
 * be told. For a feature that needs another app, so it isn't asked for while that app is off.
 */
export async function teamHasApp(
  env: { G3ID: Fetcher },
  teamId: string,
  app: string,
): Promise<boolean | null> {
  try {
    const res = await env.G3ID.fetch(
      new Request(`http://g3id/api/internal/teams/${encodeURIComponent(teamId)}/apps`),
    );
    if (!res.ok) return null;
    return ((await res.json()) as { apps: string[] }).apps.includes(app);
  } catch {
    return null;
  }
}
