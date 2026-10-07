import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { EdgeDb } from "../../db";
import { netBlocklistDomains, netBlocklists, netGrants, netSettings } from "../../db/schema";
import { agentFetch, linkStatus } from "../../lib/agent";
import { localMidnight, localParts } from "../../lib/time";
import type { AppEnv } from "../../types";

export const MAX_BLOCKLISTS = 20;
export const MAX_DOMAINS_PER_LIST = 1000;
export const GRANT_DURATIONS = ["1h", "4h", "today"] as const;
export type GrantDuration = (typeof GRANT_DURATIONS)[number];

const DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Normalizes what an admin types ("https://www.YouTube.com/watch", "*.tiktok.com")
 * to a bare domain, or null if it isn't one. A leading "www." is dropped, since
 * a domain also matches its subdomains and people mean the whole site.
 */
export function normalizeDomain(input: string): string | null {
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#:].*$/, "")
    .replace(/^\*\./, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  return DOMAIN.test(d) ? d : null;
}

export interface BlocklistInput {
  name: string;
  action: "block" | "throttle";
  rateKbps: number | null;
  enabled: boolean;
  domains: string[];
}

/** Validates a blocklist create/update body. Returns an error message or the input. */
export function parseBlocklistInput(value: unknown): BlocklistInput | string {
  const v = (value ?? {}) as Record<string, unknown>;
  const name = typeof v.name === "string" ? v.name.trim() : "";
  if (!name || name.length > 40) return "Name must be 1-40 characters.";
  if (v.action !== "block" && v.action !== "throttle") return "Action must be block or throttle.";
  let rateKbps: number | null = null;
  if (v.action === "throttle") {
    if (
      !Number.isInteger(v.rateKbps) ||
      (v.rateKbps as number) < 64 ||
      (v.rateKbps as number) > 100_000
    ) {
      return "Throttle rate must be between 64 kbit/s and 100 Mbit/s.";
    }
    rateKbps = v.rateKbps as number;
  }
  if (typeof v.enabled !== "boolean") return "enabled must be true or false.";
  if (!Array.isArray(v.domains)) return "domains must be a list.";
  const domains = new Set<string>();
  for (const raw of v.domains) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const d = normalizeDomain(raw);
    if (!d) return `"${raw}" isn't a valid domain.`;
    domains.add(d);
  }
  if (domains.size > MAX_DOMAINS_PER_LIST)
    return `A list can have at most ${MAX_DOMAINS_PER_LIST} domains.`;
  return { name, action: v.action, rateKbps, enabled: v.enabled, domains: [...domains].sort() };
}

/** When a grant made now for `duration` ends. "today" = local midnight tonight. */
export function grantExpiry(duration: GrantDuration, now: number) {
  if (duration === "1h") return now + 3600;
  if (duration === "4h") return now + 4 * 3600;
  const p = localParts(now);
  return localMidnight(p.year, p.month, p.day + 1);
}

/** Marks desired state as changed; the agent applies it and reports this version back. */
export function bumpStateVersion(db: EdgeDb) {
  return db
    .update(netSettings)
    .set({ stateVersion: sql`${netSettings.stateVersion} + 1` })
    .where(eq(netSettings.id, 1));
}

export async function listBlocklists(db: EdgeDb) {
  const [lists, domains] = await Promise.all([
    db.select().from(netBlocklists).orderBy(netBlocklists.name).all(),
    db.select().from(netBlocklistDomains).all(),
  ]);
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    action: l.action,
    rateKbps: l.rateKbps,
    enabled: l.enabled === 1,
    domains: domains.filter((d) => d.blocklistId === l.id).map((d) => d.domain),
  }));
}

export function activeGrants(db: EdgeDb, now: number) {
  return db
    .select()
    .from(netGrants)
    .where(and(gt(netGrants.expiresAt, now), isNull(netGrants.revokedAt)))
    .orderBy(netGrants.expiresAt)
    .all();
}

/** Everything the agent needs to enforce, fetched by it after a sync poke. */
export async function desiredState(db: EdgeDb) {
  const now = Math.floor(Date.now() / 1000);
  const [settings, lists, grants] = await Promise.all([
    db.select().from(netSettings).where(eq(netSettings.id, 1)).get(),
    listBlocklists(db),
    activeGrants(db, now),
  ]);
  if (!settings) throw new Error("net_settings row missing");
  return {
    version: settings.stateVersion,
    enforce: settings.enforce === 1,
    dnsHardening: settings.dnsHardening === 1,
    blocklists: lists
      .filter((l) => l.enabled && l.domains.length > 0)
      .map(({ id, action, rateKbps, domains }) => ({ id, action, rateKbps, domains })),
    grants: grants.map((g) => ({ mac: g.mac, blocklistId: g.blocklistId, expiresAt: g.expiresAt })),
  };
}

export type DesiredState = Awaited<ReturnType<typeof desiredState>>;

export type LinkState = "connected" | "not_answering" | "offline";

/**
 * Checks the worker → agent link: whether the box's WebSocket is open, and
 * that the agent answers on it (GET /health), with the round trip time.
 */
export async function probeLink(env: AppEnv["Bindings"]): Promise<{
  state: LinkState;
  detail: string | null;
  latencyMs: number | null;
  connectedAt: number | null;
  lastHeartbeatAt: number | null;
}> {
  const link = await linkStatus(env);
  const base = { connectedAt: link.connectedAt, lastHeartbeatAt: link.lastHeartbeatAt };
  if (!link.connected) return { state: "offline", detail: null, latencyMs: null, ...base };
  const started = Date.now();
  try {
    const res = await agentFetch(env, "/health", { timeoutMs: 8_000 });
    const latencyMs = Date.now() - started;
    if (res.ok) return { state: "connected", detail: null, latencyMs, ...base };
    return { state: "not_answering", detail: `HTTP ${res.status}`, latencyMs, ...base };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { state: "not_answering", detail, latencyMs: null, ...base };
  }
}

/**
 * Tells the agent to fetch and apply the desired state now. Best-effort: if
 * the box isn't connected, it catches up on its next usage push (within 5
 * minutes of reconnecting), since every agent response carries the version.
 */
export async function pokeAgent(env: AppEnv["Bindings"]) {
  try {
    const res = await agentFetch(env, "/sync", { method: "POST", timeoutMs: 5000 });
    if (!res.ok) console.warn("[Agent] sync poke returned", res.status);
  } catch (err) {
    console.warn("[Agent] sync poke failed", err instanceof Error ? err.message : err);
  }
}
