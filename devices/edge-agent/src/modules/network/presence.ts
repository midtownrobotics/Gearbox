import type { PresenceClient, PresenceResponse } from "@g3/worker-edge/presence-types";
import type { Lease } from "./parse";

/** One entry of the LAN interface's neighbor (ARP) table. */
export interface Neighbor {
  ip: string;
  /** Null while unresolved (INCOMPLETE/FAILED). */
  mac: string | null;
  /** Kernel NUD states, e.g. ["REACHABLE"], ["STALE"]. */
  state: string[];
}

/** A device confirmed this recently counts as online. Covers a few missed background checks. */
export const ONLINE_SECONDS = 120;
/** At most this many addresses are probed per check (a /24 LAN never gets close). */
const MAX_PROBES = 1024;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Parses `ip -j neigh show dev <lan>`. IPv6 entries and ones without a usable
 * address are skipped; MACs are lowercased like dnsmasq's leases.
 */
export function parseNeighbors(json: string): Neighbor[] {
  const doc = JSON.parse(json || "[]") as unknown;
  if (!Array.isArray(doc)) return [];
  const out: Neighbor[] = [];
  for (const entry of doc as { dst?: unknown; lladdr?: unknown; state?: unknown }[]) {
    if (typeof entry?.dst !== "string" || !IPV4.test(entry.dst)) continue;
    out.push({
      ip: entry.dst,
      mac: typeof entry.lladdr === "string" ? entry.lladdr.toLowerCase() : null,
      state: Array.isArray(entry.state)
        ? entry.state.filter((s): s is string => typeof s === "string")
        : [],
    });
  }
  return out;
}

/**
 * Only REACHABLE means the device answered recently. STALE just means the
 * kernel hasn't checked lately, and DELAY/PROBE are checks still in progress.
 */
export const isConfirmed = (n: Neighbor) => n.mac !== null && n.state.includes("REACHABLE");

/**
 * Every LAN device the box can put a MAC to, with its current address: the neighbor table
 * (any device that has talked on the LAN, fixed-IP ones included) and the DHCP leases. When
 * the two disagree about an address, the table wins: it's what the device uses now, and a
 * lease can outlive the device that held it. Hostnames come from the leases, by MAC.
 */
export function knownDevices(leases: Lease[], neighbors: Neighbor[]): Lease[] {
  const hostnames = new Map(leases.map((l) => [l.mac, l.hostname]));
  const byIp = new Map<string, Lease>();
  for (const n of neighbors) {
    if (n.mac) byIp.set(n.ip, { mac: n.mac, ip: n.ip, hostname: hostnames.get(n.mac) ?? null });
  }
  for (const l of leases) if (!byIp.has(l.ip)) byIp.set(l.ip, l);
  return [...byIp.values()];
}

export interface PresenceSource {
  leases(): Promise<Lease[]>;
  neighbors(): Promise<Neighbor[]>;
  /** Sends each address a packet so the kernel (re)checks it's there. */
  probe(ips: string[]): Promise<void>;
}

/**
 * Tracks which LAN devices are on, from the neighbor table rather than traffic,
 * so devices that never use the internet (printers) count too. Probing makes
 * the kernel ARP every known address: a device that answers becomes REACHABLE,
 * even one that ignores pings or sends nothing on its own.
 */
export class PresenceTracker {
  /** mac → last time it was REACHABLE, and at which address. */
  private confirmed = new Map<string, { ip: string; at: number }>();

  constructor(
    private source: PresenceSource,
    private now = () => Math.floor(Date.now() / 1000),
  ) {}

  /** Probes every known address, waits for answers, then reads the table. */
  async check(waitMs: number): Promise<PresenceResponse> {
    const [leases, before] = await Promise.all([this.source.leases(), this.source.neighbors()]);
    const ips = new Set([...leases.map((l) => l.ip), ...before.map((n) => n.ip)]);
    for (const { ip } of this.confirmed.values()) ips.add(ip);
    await this.source.probe([...ips].slice(0, MAX_PROBES));
    if (waitMs > 0) await Bun.sleep(waitMs);
    return this.read(leases, await this.source.neighbors());
  }

  /** Records what the table says now and lists every device it knows. */
  read(leases: Lease[], neighbors: Neighbor[]): PresenceResponse {
    const t = this.now();
    for (const n of neighbors) {
      if (isConfirmed(n)) this.confirmed.set(n.mac as string, { ip: n.ip, at: t });
    }
    for (const [mac, c] of this.confirmed) {
      // Forget devices long gone, so the map can't grow without bound.
      if (t - c.at > 86400) this.confirmed.delete(mac);
    }

    const hostnames = new Map(leases.map((l) => [l.mac, l.hostname]));
    const byMac = new Map<string, PresenceClient>();
    const add = (mac: string, ip: string) => {
      if (byMac.has(mac)) return;
      const at = this.confirmed.get(mac)?.at ?? null;
      byMac.set(mac, {
        mac,
        ip,
        hostname: hostnames.get(mac) ?? null,
        online: at !== null && t - at <= ONLINE_SECONDS,
        lastConfirmedAt: at,
      });
    };
    // Confirmed entries first, so a MAC listed under two addresses keeps the live one.
    for (const n of neighbors) if (isConfirmed(n)) add(n.mac as string, n.ip);
    for (const n of neighbors) if (n.mac) add(n.mac, n.ip);
    for (const [mac, c] of this.confirmed) add(mac, c.ip);
    return { checkedAt: t, clients: [...byMac.values()] };
  }
}
