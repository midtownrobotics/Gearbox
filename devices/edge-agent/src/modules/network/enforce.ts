// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Builds the agent-owned nftables table (`inet g3`) and the generated dnsmasq
 * config from the desired state. Pure functions; see enforcer.ts for applying.
 *
 * How blocking works: dnsmasq adds the IPs it resolves for a blocklist's
 * domains to that list's `bl<id>_ips` set (nftset=). Traffic between a LAN
 * client and those IPs is rejected (block) or policed per client (throttle),
 * unless the client's IP is in the list's `bl<id>_ok` set (a grant).
 */

export interface Blocklist {
  id: number;
  action: "block" | "throttle";
  rateKbps: number | null;
  domains: string[];
}

export interface Grant {
  mac: string;
  /** null = all blocklists. */
  blocklistId: number | null;
  expiresAt: number;
}

export interface NetworkState {
  version: number;
  enforce: boolean;
  dnsHardening: boolean;
  blocklists: Blocklist[];
  grants: Grant[];
}

export interface NetConfig {
  lanInterface: string;
  wanInterface: string;
  lanIp: string;
}

export const TABLE = "inet g3";

/** Resolved IPs stay in a blocklist set this long after the last lookup. */
const RESOLVED_IP_TIMEOUT = "1d";
/** Clients' DNS cache is capped so blocklist changes take effect within this. */
const MAX_TTL_SECONDS = 300;

// Well-known DNS-over-HTTPS/TLS resolvers. Their IPs are blocked on 443/853 so
// devices fall back to the box's DNS; hostnames catch the rest via nftset.
const DOH_IPS = [
  "1.1.1.1",
  "1.0.0.1",
  "1.1.1.2",
  "1.0.0.2",
  "1.1.1.3",
  "1.0.0.3",
  "8.8.8.8",
  "8.8.4.4",
  "9.9.9.9",
  "149.112.112.112",
  "9.9.9.10",
  "149.112.112.10",
  "9.9.9.11",
  "149.112.112.11",
  "208.67.222.222",
  "208.67.220.220",
  "94.140.14.14",
  "94.140.15.15",
  "45.90.28.0/24",
  "45.90.30.0/24",
  "185.228.168.9",
  "185.228.169.9",
  "76.76.2.0",
  "76.76.10.0",
];
const DOH_DOMAINS = [
  "dns.google",
  "dns.google.com",
  "cloudflare-dns.com",
  "one.one.one.one",
  "dns.cloudflare.com",
  "dns.quad9.net",
  "doh.opendns.com",
  "dns.nextdns.io",
  "dns.adguard.com",
  "dns.adguard-dns.com",
  "doh.cleanbrowsing.org",
  "freedns.controld.com",
  "doh.mullvad.net",
  "dns.mullvad.net",
];
// Answered with NXDOMAIN: Firefox's "don't use DoH here" canary and iCloud
// Private Relay (Apple devices turn it off on networks that block these).
const NXDOMAIN = ["use-application-dns.net", "mask.icloud.com", "mask-h2.icloud.com"];

const DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The worker validates too; this guards dnsmasq, since a bad line would stop DNS. */
export function safeDomains(domains: string[]) {
  return domains.filter((d) => DOMAIN.test(d));
}

/** Blocklists that are actually enforced right now. */
function activeLists(state: NetworkState) {
  return state.enforce
    ? state.blocklists.filter((l) => Number.isInteger(l.id) && safeDomains(l.domains).length > 0)
    : [];
}

/**
 * Everything that shapes the table (not domains or grants). When this changes,
 * the table is rebuilt; otherwise only grant sets are refreshed, so IPs that
 * dnsmasq has already put in the blocklist sets are kept.
 */
export function tableKey(state: NetworkState, net: NetConfig) {
  return JSON.stringify({
    net,
    hardening: state.dnsHardening,
    lists: activeLists(state).map((l) => [l.id, l.action, l.rateKbps]),
  });
}

/** Full `inet g3` table. Loading it replaces the previous one atomically. */
export function buildTable(state: NetworkState, net: NetConfig) {
  const lan = JSON.stringify(net.lanInterface);
  const wan = JSON.stringify(net.wanInterface);
  const sets: string[] = [];
  const forward: string[] = [];
  const nat: string[] = [];

  for (const l of activeLists(state)) {
    const ips = `bl${l.id}_ips`;
    const ok = `bl${l.id}_ok`;
    sets.push(
      `  set ${ips} { type ipv4_addr; flags timeout; timeout ${RESOLVED_IP_TIMEOUT}; size 65535; }`,
      `  set ${ok} { type ipv4_addr; flags timeout; size 1024; }`,
    );
    if (l.action === "block") {
      forward.push(
        `    iifname ${lan} oifname ${wan} ip daddr @${ips} ip saddr != @${ok} reject with icmpx admin-prohibited`,
        `    iifname ${wan} oifname ${lan} ip saddr @${ips} ip daddr != @${ok} drop`,
      );
    } else {
      // Police each client's download from the list's IPs; TCP backs off to the rate.
      const kbytes = Math.max(8, Math.ceil((l.rateKbps ?? 1500) / 8));
      sets.push(
        `  set bl${l.id}_rl { type ipv4_addr; size 65535; flags dynamic, timeout; timeout 1m; }`,
      );
      forward.push(
        `    iifname ${wan} oifname ${lan} ip saddr @${ips} ip daddr != @${ok} update @bl${l.id}_rl { ip daddr limit rate over ${kbytes} kbytes/second burst ${kbytes * 2} kbytes } drop`,
      );
    }
  }

  if (state.dnsHardening) {
    sets.push(
      `  set doh_static { type ipv4_addr; flags interval; elements = { ${DOH_IPS.join(", ")} } }`,
      `  set doh_ips { type ipv4_addr; flags timeout; timeout ${RESOLVED_IP_TIMEOUT}; size 4096; }`,
    );
    forward.push(
      `    iifname ${lan} oifname ${wan} tcp dport 853 reject with tcp reset`,
      `    iifname ${lan} oifname ${wan} udp dport 853 reject`,
    );
    for (const set of ["doh_static", "doh_ips"]) {
      forward.push(
        `    iifname ${lan} oifname ${wan} ip daddr @${set} tcp dport 443 reject with tcp reset`,
        `    iifname ${lan} oifname ${wan} ip daddr @${set} udp dport 443 reject`,
      );
    }
    nat.push(
      `    iifname ${lan} ip daddr != ${net.lanIp} udp dport 53 dnat ip to ${net.lanIp}`,
      `    iifname ${lan} ip daddr != ${net.lanIp} tcp dport 53 dnat ip to ${net.lanIp}`,
    );
  }

  const out = [`table ${TABLE}`, `delete table ${TABLE}`, `table ${TABLE} {`, ...sets];
  out.push(
    "  chain forward {",
    "    type filter hook forward priority -5; policy accept;",
    ...forward,
    "  }",
  );
  if (nat.length > 0) {
    out.push(
      "  chain dns_redirect {",
      "    type nat hook prerouting priority dstnat; policy accept;",
      ...nat,
      "  }",
    );
  }
  out.push("}");
  return `${out.join("\n")}\n`;
}

/**
 * Replaces every list's grant set with the current grants (MAC → current IP,
 * timeout = time left). Run on every sync and collection, so grants follow
 * IP changes and expire on their own if the agent stops.
 */
export function buildGrantRefresh(
  state: NetworkState,
  macToIp: Map<string, string>,
  now: number,
): string {
  const lists = activeLists(state);
  if (lists.length === 0) return "";
  const perList = new Map<number, Map<string, number>>(lists.map((l) => [l.id, new Map()]));
  for (const g of state.grants) {
    const ip = g.mac.startsWith("ip:") ? g.mac.slice(3) : macToIp.get(g.mac);
    const left = g.expiresAt - now;
    if (!ip || !IPV4.test(ip) || left <= 0) continue;
    for (const [id, ips] of perList) {
      if (g.blocklistId !== null && g.blocklistId !== id) continue;
      ips.set(ip, Math.max(ips.get(ip) ?? 0, left));
    }
  }
  const lines: string[] = [];
  for (const [id, ips] of perList) {
    lines.push(`flush set ${TABLE} bl${id}_ok`);
    if (ips.size > 0) {
      const elems = [...ips].map(([ip, left]) => `${ip} timeout ${left}s`).join(", ");
      lines.push(`add element ${TABLE} bl${id}_ok { ${elems} }`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The generated dnsmasq config. It includes the table key, so any table
 * rebuild also restarts dnsmasq, which clears its cache and makes clients'
 * next lookups repopulate the (new, empty) blocklist sets.
 */
export function buildDnsmasqConf(state: NetworkState, net: NetConfig): string {
  const lines = [
    "# Generated by g3-edge-agent from the Edge UI. Do not edit; changes are overwritten.",
    `# table: ${tableKey(state, net)}`,
  ];
  const lists = activeLists(state);
  if (lists.length > 0 || state.dnsHardening) lines.push(`max-ttl=${MAX_TTL_SECONDS}`);
  for (const l of lists) {
    const domains = safeDomains(l.domains);
    // Keep lines short; dnsmasq has a line length limit.
    for (let i = 0; i < domains.length; i += 20) {
      lines.push(`nftset=/${domains.slice(i, i + 20).join("/")}/4#inet#g3#bl${l.id}_ips`);
    }
  }
  if (state.dnsHardening) {
    for (let i = 0; i < DOH_DOMAINS.length; i += 20) {
      lines.push(`nftset=/${DOH_DOMAINS.slice(i, i + 20).join("/")}/4#inet#g3#doh_ips`);
    }
    for (const d of NXDOMAIN) lines.push(`address=/${d}/`);
  }
  return `${lines.join("\n")}\n`;
}
