// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type NetworkState,
  buildDnsmasqConf,
  buildGrantRefresh,
  buildTable,
  safeDomains,
  tableKey,
} from "./enforce";

const net = { lanInterface: "lan0", wanInterface: "wan0", lanIp: "192.168.50.1" };

const state: NetworkState = {
  version: 7,
  enforce: true,
  dnsHardening: true,
  blocklists: [
    { id: 1, action: "block", rateKbps: null, domains: ["tiktok.com", "tiktokcdn.com"] },
    { id: 2, action: "throttle", rateKbps: 1500, domains: ["googlevideo.com"] },
    { id: 3, action: "block", rateKbps: null, domains: [] },
  ],
  grants: [
    { mac: "aa:aa:aa:aa:aa:01", blocklistId: 2, expiresAt: 1000 + 3600 },
    { mac: "aa:aa:aa:aa:aa:01", blocklistId: null, expiresAt: 1000 + 60 },
    { mac: "aa:aa:aa:aa:aa:02", blocklistId: 1, expiresAt: 900 },
    { mac: "aa:aa:aa:aa:aa:03", blocklistId: 1, expiresAt: 5000 },
  ],
};
const macToIp = new Map([
  ["aa:aa:aa:aa:aa:01", "192.168.50.101"],
  ["aa:aa:aa:aa:aa:02", "192.168.50.102"],
]);

/** Checks a script with the real nft in an unprivileged namespace, if this machine allows it. */
function nftCheck(script: string) {
  const dir = mkdtempSync(join(tmpdir(), "g3-nft-"));
  const file = join(dir, "t.nft");
  writeFileSync(file, script);
  const probe = Bun.spawnSync(["unshare", "-rn", "nft", "list", "ruleset"], { stderr: "pipe" });
  if (probe.exitCode !== 0) return null; // No nft or no user namespaces (e.g. CI): skip.
  const res = Bun.spawnSync(["unshare", "-rn", "nft", "-c", "-f", file], { stderr: "pipe" });
  return { ok: res.exitCode === 0, error: res.stderr.toString() };
}

describe("buildTable", () => {
  test("has sets and rules for enforced lists only, plus hardening", () => {
    const table = buildTable(state, net);
    expect(table).toStartWith("table inet g3\ndelete table inet g3\n");
    expect(table).toContain("set bl1_ips");
    expect(table).toContain("set bl2_rl");
    expect(table).not.toContain("bl3_"); // No domains: nothing to enforce.
    expect(table).toContain("reject with icmpx admin-prohibited");
    expect(table).toContain("limit rate over 188 kbytes/second");
    expect(table).toContain("ip daddr != 192.168.50.1 udp dport 53 dnat ip to 192.168.50.1");
  });

  test("with enforcement and hardening off, is an empty shell", () => {
    const table = buildTable({ ...state, enforce: false, dnsHardening: false }, net);
    expect(table).not.toContain("set ");
    expect(table).not.toContain("dns_redirect");
  });

  test("is valid nftables", () => {
    for (const s of [state, { ...state, enforce: false, dnsHardening: false }]) {
      const result = nftCheck(buildTable(s, net));
      if (result) expect(result.error).toBe("");
    }
  });
});

describe("tableKey", () => {
  test("ignores domains and grants, but not actions", () => {
    const key = tableKey(state, net);
    const moreDomains = {
      ...state,
      blocklists: state.blocklists.map((l) =>
        l.domains.length ? { ...l, domains: [...l.domains, "x.com"] } : l,
      ),
    };
    expect(tableKey({ ...moreDomains, grants: [] }, net)).toBe(key);
    // A list that gains its first domain starts being enforced, so the table changes.
    const listThreeOn = {
      ...state,
      blocklists: state.blocklists.map((l) => (l.id === 3 ? { ...l, domains: ["x.com"] } : l)),
    };
    expect(tableKey(listThreeOn, net)).not.toBe(key);
    const blocked = {
      ...state,
      blocklists: state.blocklists.map((l) => ({ ...l, action: "block" as const })),
    };
    expect(tableKey(blocked, net)).not.toBe(key);
  });
});

describe("buildGrantRefresh", () => {
  test("maps MACs to IPs, applies all-list grants, keeps the longest, skips expired", () => {
    expect(buildGrantRefresh(state, macToIp, 1000)).toBe(
      [
        "flush set inet g3 bl1_ok",
        "add element inet g3 bl1_ok { 192.168.50.101 timeout 60s }",
        "flush set inet g3 bl2_ok",
        "add element inet g3 bl2_ok { 192.168.50.101 timeout 3600s }",
        "",
      ].join("\n"),
    );
  });

  test("is valid against the table", () => {
    const script = buildTable(state, net) + buildGrantRefresh(state, macToIp, 1000);
    const result = nftCheck(script);
    if (result) expect(result.error).toBe("");
  });

  test("does nothing when enforcement is off", () => {
    expect(buildGrantRefresh({ ...state, enforce: false }, macToIp, 1000)).toBe("");
  });
});

describe("buildDnsmasqConf", () => {
  test("adds nftsets per list and hardening entries", () => {
    const conf = buildDnsmasqConf(state, net);
    expect(conf).toContain("nftset=/tiktok.com/tiktokcdn.com/4#inet#g3#bl1_ips\n");
    expect(conf).toContain("nftset=/googlevideo.com/4#inet#g3#bl2_ips\n");
    expect(conf).toContain("address=/use-application-dns.net/\n");
    expect(conf).toContain("max-ttl=300\n");
    expect(conf).not.toContain("bl3_");
  });

  test("changes when the table would be rebuilt", () => {
    const blocked = {
      ...state,
      blocklists: state.blocklists.map((l) => ({ ...l, action: "block" as const })),
    };
    expect(buildDnsmasqConf(blocked, net)).not.toBe(buildDnsmasqConf(state, net));
  });

  test("is accepted by dnsmasq", () => {
    const dnsmasq = Bun.which("dnsmasq") ?? Bun.which("/usr/sbin/dnsmasq");
    if (!dnsmasq) return;
    const file = join(mkdtempSync(join(tmpdir(), "g3-dnsmasq-")), "g3-edge.conf");
    writeFileSync(file, buildDnsmasqConf(state, net));
    const res = Bun.spawnSync([dnsmasq, "--test", `--conf-file=${file}`], { stderr: "pipe" });
    expect(res.stderr.toString()).toContain("syntax check OK");
  });

  test("drops anything that isn't a plain domain", () => {
    expect(safeDomains(["ok.com", "bad domain.com", "evil.com/\nserver=1.2.3.4", "x"])).toEqual([
      "ok.com",
    ]);
  });
});
