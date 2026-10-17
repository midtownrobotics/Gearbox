// A team's members with their roles, and messages to them on the team's chat (Slack or Discord,
// whichever it connected), from G3ID over the service binding (its /api/internal routes are never
// reachable through the gateway). Apps keep no list of people of their own, never hold a team's
// chat token, and never know which chat a team uses.
//
// Messages are written in Gearbox's chat format, which Discord reads as it is and G3ID turns into
// Slack's mrkdwn: **bold**, [label](https://...), "> " quotes, Unicode emoji (not :names:) and line
// breaks.

export type Member = {
  id: string;
  displayName: string;
  email: string;
  status: "pending" | "active" | "rejected" | "merged";
  isAdmin: boolean;
  isMentor: boolean;
  /** Has linked the team's chat (Slack or Discord), so the team's bot can DM them. */
  hasChat?: boolean;
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
 * Sends a direct message from the team's own bot to members by their G3ID ids. Only active
 * members with the team's chat linked get it. Returns how many were sent (0 when the team has no
 * chat, or G3ID couldn't be reached); it never throws, so callers can fire and forget.
 */
export async function sendMemberDM(
  env: { G3ID: Fetcher },
  teamId: string,
  userIds: string[],
  text: string,
): Promise<number> {
  try {
    const res = await env.G3ID.fetch(
      new Request(`http://g3id/api/internal/teams/${encodeURIComponent(teamId)}/chat/dm-members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds, text }),
      }),
    );
    if (res.ok) return ((await res.json()) as { sent?: number }).sent ?? 0;
    if (res.status !== 404) {
      console.error("[chat] member DM failed", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("[chat] member DM failed", err);
  }
  return 0;
}

/**
 * Posts to one of the team's channels (a Slack or Discord channel id) from its own bot. Never
 * throws: gives back why it wasn't posted (the team has no chat, or the service's refusal, like
 * "not_in_channel").
 */
export async function sendTeamMessage(
  env: { G3ID: Fetcher },
  teamId: string,
  channel: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await env.G3ID.fetch(
      new Request(`http://g3id/api/internal/teams/${encodeURIComponent(teamId)}/chat/message`, {
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
