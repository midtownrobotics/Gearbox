import { sql } from "drizzle-orm";
import type { EdgeDb } from "../../db";
import { netClients } from "../../db/schema";
import { AgentError, agentFetch, missingRouteMessage } from "../../lib/agent";
import type { AppEnv } from "../../types";
import type { PresenceResponse } from "./presence-types";

/** The box probes the LAN for about 1.5 s; leave room for the tunnel. */
const PRESENCE_TIMEOUT_MS = 8_000;

export type LivePresence =
  | { available: true; checkedAt: number; online: Set<string> }
  | { available: false; error: string };

/**
 * Asks the box (through the tunnel) which LAN devices are on right now, and
 * records each one it hasn't seen yet, so devices that never use the internet
 * (printers) are listed too. Never throws: when the box can't be asked, the
 * page still shows the stored list without online dots.
 */
export async function livePresence(env: AppEnv["Bindings"], db: EdgeDb): Promise<LivePresence> {
  let body: PresenceResponse;
  try {
    const res = await agentFetch(env, "/network/presence", { timeoutMs: PRESENCE_TIMEOUT_MS });
    if (res.status === 404) {
      return { available: false, error: await missingRouteMessage(res, "/network") };
    }
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      return { available: false, error: error ?? `The edge box returned HTTP ${res.status}.` };
    }
    body = (await res.json()) as PresenceResponse;
  } catch (err) {
    if (err instanceof AgentError) return { available: false, error: err.message };
    return { available: false, error: "The edge box sent an unreadable answer." };
  }

  const online = body.clients.filter((c) => c.online && typeof c.mac === "string");
  // D1 allows 100 bound parameters per statement: 5 per row.
  const statements = [];
  for (let i = 0; i < online.length; i += 15) {
    const rows = online.slice(i, i + 15).map((c) => ({
      mac: c.mac.slice(0, 64),
      hostname: c.hostname?.slice(0, 255) ?? null,
      lastIp: c.ip.slice(0, 255),
      firstSeenAt: body.checkedAt,
      lastSeenAt: body.checkedAt,
    }));
    statements.push(
      db
        .insert(netClients)
        .values(rows)
        .onConflictDoUpdate({
          target: netClients.mac,
          set: {
            hostname: sql`coalesce(excluded.hostname, ${netClients.hostname})`,
            lastIp: sql`excluded.last_ip`,
            lastSeenAt: sql`max(${netClients.lastSeenAt}, excluded.last_seen_at)`,
          },
        }),
    );
  }
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
  return { available: true, checkedAt: body.checkedAt, online: new Set(online.map((c) => c.mac)) };
}

/** null: unknown (the box couldn't be asked). */
export const onlineFlag = (presence: LivePresence, mac: string) =>
  presence.available ? presence.online.has(mac) : null;

/** What the page shows about the live check. */
export const presenceSummary = (presence: LivePresence) =>
  presence.available
    ? { available: true as const, checkedAt: presence.checkedAt, error: null }
    : { available: false as const, checkedAt: null, error: presence.error };
