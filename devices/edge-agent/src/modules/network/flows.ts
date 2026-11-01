// SPDX-License-Identifier: AGPL-3.0-only
import type { Counters, Usage } from "./deltas";
import { UNKNOWN_SITE, siteFor } from "./sites";

/** Flow counter keys are "dl|<client>|<remote>" or "ul|<client>|<remote>". */
export function flowKey(dir: "dl" | "ul", client: string, remote: string) {
  return `${dir}|${client}|${remote}`;
}

export function parseFlowKey(key: string) {
  const [dir, client, remote] = key.split("|");
  return { dir: dir as "dl" | "ul", client, remote };
}

/** Flows whose counter hasn't moved since the last reading. */
export function idleFlows(prev: Counters, curr: Counters): string[] {
  const idle: string[] = [];
  for (const [key, value] of curr) if (prev.get(key) === value) idle.push(key);
  return idle;
}

/**
 * Attributes flow byte deltas to (client MAC, site). The site comes from the
 * DNS name the client looked up for that remote IP; unknown IPs go to "(unknown)".
 */
export function attributeFlows(
  deltas: Counters,
  macByIp: Map<string, string>,
  nameFor: (client: string, remote: string) => string | null,
): Map<string, Map<string, Usage>> {
  const out = new Map<string, Map<string, Usage>>();
  const siteCache = new Map<string, string>();
  for (const [key, bytes] of deltas) {
    const { dir, client, remote } = parseFlowKey(key);
    const mac = macByIp.get(client) ?? `ip:${client}`;
    const cacheKey = `${client}|${remote}`;
    let site = siteCache.get(cacheKey);
    if (site === undefined) {
      const name = nameFor(client, remote);
      site = name ? siteFor(name) : UNKNOWN_SITE;
      siteCache.set(cacheKey, site);
    }
    const sites = out.get(mac) ?? new Map<string, Usage>();
    const u = sites.get(site) ?? { dl: 0, ul: 0 };
    u[dir] += bytes;
    sites.set(site, u);
    out.set(mac, sites);
  }
  return out;
}
