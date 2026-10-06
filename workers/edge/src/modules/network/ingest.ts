import { sql } from "drizzle-orm";
import type { EdgeDb } from "../../db";
import { netClients, netUsage } from "../../db/schema";

export const BUCKET_SECONDS = 300;
export const MAX_SAMPLES_PER_BATCH = 2000;

/** One 5-minute bucket for one client: [bucketStartTs, mac, dlBytes, ulBytes]. */
export type UsageSample = [ts: number, mac: string, dl: number, ul: number];

export interface UsageClient {
  mac: string;
  hostname: string | null;
  ip: string | null;
}

export interface UsageBatch {
  samples: UsageSample[];
  clients: UsageClient[];
}

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isKey = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isOptText = (v: unknown): v is string | null =>
  v === null || (typeof v === "string" && v.length <= 255);

/** Returns the batch if it is well-formed, otherwise null. */
export function parseUsageBatch(value: unknown): UsageBatch | null {
  if (typeof value !== "object" || value === null) return null;
  const { samples, clients } = value as Record<string, unknown>;
  if (!Array.isArray(samples) || !Array.isArray(clients)) return null;
  if (samples.length > MAX_SAMPLES_PER_BATCH || clients.length > MAX_SAMPLES_PER_BATCH) return null;
  for (const s of samples) {
    if (!Array.isArray(s) || s.length !== 4) return null;
    const [ts, mac, dl, ul] = s;
    if (!isCount(ts) || ts % BUCKET_SECONDS !== 0) return null;
    if (!isKey(mac) || !isCount(dl) || !isCount(ul)) return null;
  }
  for (const c of clients) {
    if (typeof c !== "object" || c === null) return null;
    const { mac, hostname, ip } = c as Record<string, unknown>;
    if (!isKey(mac) || !isOptText(hostname) || !isOptText(ip)) return null;
  }
  return { samples: samples as UsageSample[], clients: clients as UsageClient[] };
}

// D1 allows 100 bound parameters per statement.
function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Stores a batch. Samples carry full bucket totals, so re-sending a bucket
 * replaces it rather than adding to it — retries and replays are safe.
 */
export async function ingestUsage(db: EdgeDb, batch: UsageBatch) {
  const now = Math.floor(Date.now() / 1000);

  const lastSeen = new Map<string, number>();
  for (const [ts, mac] of batch.samples) {
    const end = ts + BUCKET_SECONDS;
    if ((lastSeen.get(mac) ?? 0) < end) lastSeen.set(mac, Math.min(end, now));
  }
  const clientInfo = new Map(batch.clients.map((c) => [c.mac, c]));

  const statements = [];
  for (const rows of chunk(batch.samples, 20)) {
    statements.push(
      db
        .insert(netUsage)
        .values(rows.map(([ts, mac, dl, ul]) => ({ ts, mac, dlBytes: dl, ulBytes: ul })))
        .onConflictDoUpdate({
          target: [netUsage.ts, netUsage.mac],
          set: { dlBytes: sql`excluded.dl_bytes`, ulBytes: sql`excluded.ul_bytes` },
        }),
    );
  }

  // Keys starting with "_" are pseudo-clients ("_wan" totals, "_lookup" part lookups), not devices.
  const clientRows = [...lastSeen]
    .filter(([mac]) => !mac.startsWith("_"))
    .map(([mac, seenAt]) => ({
      mac,
      hostname: clientInfo.get(mac)?.hostname ?? null,
      lastIp: clientInfo.get(mac)?.ip ?? null,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    }));
  for (const rows of chunk(clientRows, 15)) {
    statements.push(
      db
        .insert(netClients)
        .values(rows)
        .onConflictDoUpdate({
          target: netClients.mac,
          set: {
            hostname: sql`coalesce(excluded.hostname, ${netClients.hostname})`,
            lastIp: sql`coalesce(excluded.last_ip, ${netClients.lastIp})`,
            firstSeenAt: sql`min(${netClients.firstSeenAt}, excluded.first_seen_at)`,
            lastSeenAt: sql`max(${netClients.lastSeenAt}, excluded.last_seen_at)`,
          },
        }),
    );
  }

  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
  return { stored: batch.samples.length };
}
