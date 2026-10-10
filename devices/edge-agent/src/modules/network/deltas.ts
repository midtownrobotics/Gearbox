import type { Lease } from "./parse";

export const BUCKET_SECONDS = 300;
export const WAN_KEY = "_wan";

/**
 * Monotonic byte counters keyed "dl:<ip>", "ul:<ip>", "wan:rx", "wan:tx".
 * They reset when the box reboots or nftables is reloaded.
 */
export type Counters = Map<string, number>;

export interface Usage {
  dl: number;
  ul: number;
}

/**
 * Bytes counted since the previous reading. A counter lower than before was
 * reset, so its whole value is new traffic; `reset` (e.g. after a reboot)
 * treats every counter that way. Counters with no previous value are new set
 * elements, which also start from zero.
 */
export function counterDeltas(prev: Counters, curr: Counters, reset = false): Counters {
  const out: Counters = new Map();
  for (const [key, value] of curr) {
    const before = reset ? undefined : prev.get(key);
    const delta = before === undefined || value < before ? value : value - before;
    if (delta > 0) out.set(key, delta);
  }
  return out;
}

/**
 * Attributes per-IP deltas to clients by MAC (IPs change, MACs don't), using
 * the LAN's known devices (leases and neighbor table). IPs with no known MAC are keyed "ip:<addr>". WAN
 * interface totals go to the "_wan" pseudo-client.
 */
export function attribute(deltas: Counters, leases: Lease[]): Map<string, Usage> {
  const macByIp = new Map(leases.map((l) => [l.ip, l.mac]));
  const out = new Map<string, Usage>();
  const add = (key: string, field: keyof Usage, bytes: number) => {
    const u = out.get(key) ?? { dl: 0, ul: 0 };
    u[field] += bytes;
    out.set(key, u);
  };
  for (const [key, bytes] of deltas) {
    if (key === "wan:rx") add(WAN_KEY, "dl", bytes);
    else if (key === "wan:tx") add(WAN_KEY, "ul", bytes);
    else {
      const [dir, ip] = [key.slice(0, 2), key.slice(3)];
      const client = macByIp.get(ip) ?? `ip:${ip}`;
      add(client, dir === "dl" ? "dl" : "ul", bytes);
    }
  }
  return out;
}

/**
 * The 5-minute bucket a reading interval belongs to, by its midpoint. The
 * collector runs just after each bucket boundary, so this is the bucket that
 * just ended.
 */
export function bucketFor(prevTs: number, ts: number) {
  const mid = (prevTs + ts) / 2;
  return Math.floor(mid / BUCKET_SECONDS) * BUCKET_SECONDS;
}
