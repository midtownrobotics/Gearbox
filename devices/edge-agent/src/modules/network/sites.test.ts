// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../core/db";
import { DnsLogTailer } from "./dns-log";
import { attributeFlows, flowKey, idleFlows } from "./flows";
import { parseDnsLog, parseNftFlowSet } from "./parse";
import { SiteStore } from "./site-store";
import { siteFor } from "./sites";

describe("parseNftFlowSet", () => {
  test("reads concatenated (client . remote) elements", () => {
    // Captured from nft 1.1.5.
    const json = `{"nftables": [{"metainfo": {"version": "1.1.5", "release_name": "Commodore Bullmoose #6", "json_schema_version": 1}}, {"set": {"family": "inet", "name": "flows_ul", "table": "acct", "type": ["ipv4_addr", "ipv4_addr"], "handle": 2, "size": 65535, "flags": ["timeout", "dynamic"], "timeout": 3600, "elem": [{"elem": {"val": {"concat": ["192.168.50.101", "142.250.65.78"]}, "expires": 3599, "counter": {"packets": 3, "bytes": 186}}}, {"elem": {"val": {"concat": ["192.168.50.102", "140.82.112.3"]}, "expires": 3599, "counter": {"packets": 1, "bytes": 59}}}]}}]}`;
    expect(parseNftFlowSet(json)).toEqual(
      new Map([
        ["192.168.50.101|142.250.65.78", 186],
        ["192.168.50.102|140.82.112.3", 59],
      ]),
    );
  });
});

describe("parseDnsLog", () => {
  test("maps answers (including CNAME chains) to the name the client asked for", () => {
    const pending = new Map<string, string>();
    const answers = parseDnsLog(
      [
        "Sep 29 19:00:01 dnsmasq[812]: 57 192.168.50.101/53172 query[A] www.YouTube.com from 192.168.50.101",
        "Sep 29 19:00:01 dnsmasq[812]: 57 192.168.50.101/53172 forwarded www.youtube.com to 1.1.1.1",
        "Sep 29 19:00:01 dnsmasq[812]: 57 192.168.50.101/53172 reply www.youtube.com is <CNAME>",
        "Sep 29 19:00:01 dnsmasq[812]: 57 192.168.50.101/53172 reply youtube-ui.l.google.com is 142.250.65.78",
        "Sep 29 19:00:01 dnsmasq[812]: 57 192.168.50.101/53172 reply youtube-ui.l.google.com is 142.250.65.110",
        "Sep 29 19:00:02 dnsmasq[812]: 58 192.168.50.102/40000 query[AAAA] github.com from 192.168.50.102",
        "Sep 29 19:00:02 dnsmasq[812]: 58 192.168.50.102/40000 reply github.com is NODATA-IPv6",
        "Sep 29 19:00:02 dnsmasq[812]: 59 192.168.50.102/40001 query[A] github.com from 192.168.50.102",
      ],
      pending,
    );
    expect(answers).toEqual([
      { client: "192.168.50.101", name: "www.youtube.com", ip: "142.250.65.78" },
      { client: "192.168.50.101", name: "www.youtube.com", ip: "142.250.65.110" },
    ]);

    // The answer for query 59 arrives in the next read.
    const later = parseDnsLog(
      ["Sep 29 19:00:02 dnsmasq[812]: 59 192.168.50.102/40001 cached github.com is 140.82.112.3"],
      pending,
    );
    expect(later).toEqual([{ client: "192.168.50.102", name: "github.com", ip: "140.82.112.3" }]);
  });
});

describe("siteFor", () => {
  test("reduces hostnames to registrable domains", () => {
    expect(siteFor("rr3---sn-abc.googlevideo.com")).toBe("googlevideo.com");
    expect(siteFor("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(siteFor("API.GitHub.com.")).toBe("github.com");
  });
});

describe("flows", () => {
  const m = (entries: Record<string, number>) => new Map(Object.entries(entries));

  test("idleFlows finds counters that didn't move", () => {
    expect(idleFlows(m({ a: 1, b: 2 }), m({ a: 1, b: 3, c: 0 }))).toEqual(["a"]);
  });

  test("attributeFlows groups by MAC and site, unknown IPs as (unknown)", () => {
    const deltas = new Map([
      [flowKey("dl", "192.168.50.101", "142.250.65.78"), 1000],
      [flowKey("ul", "192.168.50.101", "142.250.65.78"), 100],
      [flowKey("dl", "192.168.50.101", "142.250.65.110"), 500],
      [flowKey("dl", "192.168.50.101", "9.9.9.9"), 7],
      [flowKey("dl", "192.168.50.150", "142.250.65.78"), 3],
    ]);
    const names: Record<string, string> = {
      "142.250.65.78": "www.youtube.com",
      "142.250.65.110": "rr1.googlevideo.com",
    };
    const out = attributeFlows(
      deltas,
      new Map([["192.168.50.101", "aa:aa:aa:aa:aa:01"]]),
      (_client, remote) => names[remote] ?? null,
    );
    expect(out).toEqual(
      new Map([
        [
          "aa:aa:aa:aa:aa:01",
          new Map([
            ["youtube.com", { dl: 1000, ul: 100 }],
            ["googlevideo.com", { dl: 500, ul: 0 }],
            ["(unknown)", { dl: 7, ul: 0 }],
          ]),
        ],
        ["ip:192.168.50.150", new Map([["youtube.com", { dl: 3, ul: 0 }]])],
      ]),
    );
  });
});

describe("SiteStore", () => {
  test("prefers the client's own lookup, then anyone's latest", () => {
    const store = new SiteStore(openDb(":memory:"));
    store.recordDns([{ client: "10.0.0.1", name: "a.example.com", ip: "1.1.1.1" }], 100);
    store.recordDns([{ client: "10.0.0.2", name: "b.example.com", ip: "1.1.1.1" }], 200);
    expect(store.nameFor("10.0.0.1", "1.1.1.1")).toBe("a.example.com");
    expect(store.nameFor("10.0.0.3", "1.1.1.1")).toBe("b.example.com");
    expect(store.nameFor("10.0.0.3", "2.2.2.2")).toBeNull();
  });

  test("keeps each client's top sites per hour and sums the rest as (other)", () => {
    const store = new SiteStore(openDb(":memory:"));
    const usage = new Map([
      [
        "mac1",
        new Map([
          ["a.com", { dl: 300, ul: 0 }],
          ["b.com", { dl: 200, ul: 0 }],
          ["c.com", { dl: 50, ul: 5 }],
          ["d.com", { dl: 40, ul: 0 }],
        ]),
      ],
    ]);
    store.record({ ts: 7300, bootId: "x", counters: new Map(), hour: 3600, usage });
    expect(store.unsentHours(7300, 10)).toEqual([3600]);
    expect(store.rowsFor([3600], 2)).toEqual([
      [3600, "mac1", "(other)", 90, 5],
      [3600, "mac1", "a.com", 300, 0],
      [3600, "mac1", "b.com", 200, 0],
    ]);
    store.markHoursSent([3600]);
    expect(store.unsentHours(7300, 10)).toEqual([]);
  });
});

describe("DnsLogTailer", () => {
  test("reads only complete new lines and follows logrotate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "g3-dns-"));
    const path = join(dir, "queries.log");
    const tailer = new DnsLogTailer(path, openDb(":memory:"));
    expect(await tailer.read()).toEqual([]);

    writeFileSync(path, "one\ntwo\nthr");
    expect(await tailer.read()).toEqual(["one", "two"]);
    writeFileSync(path, "one\ntwo\nthree\nfour\n");
    expect(await tailer.read()).toEqual(["three", "four"]);

    // logrotate (create mode): old file moved to .1 after one more line, new file started.
    writeFileSync(path, "one\ntwo\nthree\nfour\nfive\n");
    renameSync(path, `${path}.1`);
    writeFileSync(path, "six\n");
    expect(await tailer.read()).toEqual(["five", "six"]);

    // Truncated in place to less than what was read: start over from the top.
    writeFileSync(path, "");
    rmSync(`${path}.1`);
    expect(await tailer.read()).toEqual([]);
    writeFileSync(path, "seven\n");
    expect(await tailer.read()).toEqual(["seven"]);
  });
});
