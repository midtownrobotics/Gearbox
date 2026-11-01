// SPDX-License-Identifier: AGPL-3.0-only
export interface Lease {
  mac: string;
  ip: string;
  hostname: string | null;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Parses dnsmasq's leases file. IPv4 lines look like:
 *   <expiry> <mac> <ip> <hostname|*> <client-id|*>
 * IPv6 lines and the "duid" line are skipped.
 */
export function parseLeases(text: string): Lease[] {
  const leases: Lease[] = [];
  for (const line of text.split("\n")) {
    const [, mac, ip, hostname] = line.trim().split(/\s+/);
    if (!mac || !ip || !IPV4.test(ip)) continue;
    leases.push({
      mac: mac.toLowerCase(),
      ip,
      hostname: hostname && hostname !== "*" ? hostname : null,
    });
  }
  return leases;
}

type NftElem = string | { elem?: { val?: unknown; counter?: { bytes?: unknown } } };

/**
 * Parses `nft -j list set inet acct <name>` into ip → byte counter. Elements of
 * a dynamic set with `counter` look like {"elem": {"val": ip, "counter": {...}}}.
 */
export function parseNftSet(json: string): Map<string, number> {
  const out = new Map<string, number>();
  const doc = JSON.parse(json) as { nftables?: { set?: { elem?: NftElem[] } }[] };
  for (const entry of doc.nftables ?? []) {
    for (const el of entry.set?.elem ?? []) {
      if (typeof el !== "object") continue;
      const ip = el.elem?.val;
      const bytes = el.elem?.counter?.bytes;
      if (typeof ip === "string" && typeof bytes === "number") out.set(ip, bytes);
    }
  }
  return out;
}

/**
 * Parses a flows set (`type ipv4_addr . ipv4_addr`, elements keyed
 * client . remote) into "client|remote" → byte counter.
 */
export function parseNftFlowSet(json: string): Map<string, number> {
  const out = new Map<string, number>();
  const doc = JSON.parse(json) as {
    nftables?: {
      set?: { elem?: { elem?: { val?: { concat?: unknown }; counter?: { bytes?: unknown } } }[] };
    }[];
  };
  for (const entry of doc.nftables ?? []) {
    for (const el of entry.set?.elem ?? []) {
      const pair = el?.elem?.val?.concat;
      const bytes = el?.elem?.counter?.bytes;
      if (!Array.isArray(pair) || pair.length !== 2 || typeof bytes !== "number") continue;
      const [client, remote] = pair;
      if (typeof client === "string" && typeof remote === "string")
        out.set(`${client}|${remote}`, bytes);
    }
  }
  return out;
}

export interface DnsAnswer {
  /** LAN client that asked. */
  client: string;
  /** The name the client asked for (not the CNAME target). */
  name: string;
  /** IPv4 address in the answer. */
  ip: string;
}

// With `log-queries=extra`, every line of a query carries a serial and the client:
//   Sep 29 19:00:01 dnsmasq[812]: 57 192.168.50.101/53172 query[A] www.youtube.com from 192.168.50.101
//   Sep 29 19:00:01 dnsmasq[812]: 57 192.168.50.101/53172 reply youtube-ui.l.google.com is 142.250.65.78
const DNS_LINE = /dnsmasq\[\d+\]: (\d+) (\d{1,3}(?:\.\d{1,3}){3})\/\d+ (\S+) (\S+)(?: is (\S+))?/;
const ANSWER_KINDS = new Set(["reply", "cached", "config"]);
const MAX_PENDING = 10_000;

/**
 * Turns dnsmasq query log lines into (client, name, ip) answers. `pending`
 * maps query serial → asked name and carries over between calls, since a
 * query's lines can be split across two reads.
 */
export function parseDnsLog(lines: string[], pending: Map<string, string>): DnsAnswer[] {
  const answers: DnsAnswer[] = [];
  for (const line of lines) {
    const m = DNS_LINE.exec(line);
    if (!m) continue;
    const [, serial, client, kind, name, ip] = m;
    const key = `${client}#${serial}`;
    if (kind.startsWith("query[")) {
      pending.delete(key);
      pending.set(key, name.toLowerCase());
      if (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value as string);
    } else if (ANSWER_KINDS.has(kind) && ip && IPV4.test(ip)) {
      answers.push({ client, name: pending.get(key) ?? name.toLowerCase(), ip });
    }
  }
  return answers;
}
