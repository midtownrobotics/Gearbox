// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test";
import { parseLeases, parseNftSet } from "./parse";

describe("parseLeases", () => {
  test("parses IPv4 leases and skips IPv6/duid lines", () => {
    const text = [
      "1727640000 AA:BB:CC:DD:EE:01 192.168.50.101 drive-station 01:aa:bb:cc:dd:ee:01",
      "1727640000 aa:bb:cc:dd:ee:02 192.168.50.102 * *",
      "duid 00:01:00:01:2c:aa",
      "1727640000 1234 fd00::5 phone *",
      "",
    ].join("\n");
    expect(parseLeases(text)).toEqual([
      { mac: "aa:bb:cc:dd:ee:01", ip: "192.168.50.101", hostname: "drive-station" },
      { mac: "aa:bb:cc:dd:ee:02", ip: "192.168.50.102", hostname: null },
    ]);
  });
});

describe("parseNftSet", () => {
  test("reads counters from dynamic set elements", () => {
    const json = JSON.stringify({
      nftables: [
        { metainfo: { version: "1.0.9", json_schema_version: 1 } },
        {
          set: {
            family: "inet",
            name: "dl",
            table: "acct",
            type: "ipv4_addr",
            flags: ["dynamic"],
            elem: [
              { elem: { val: "192.168.50.101", counter: { packets: 10, bytes: 1500 } } },
              { elem: { val: "192.168.50.102", counter: { packets: 1, bytes: 60 } } },
              "192.168.50.103",
            ],
          },
        },
      ],
    });
    expect(parseNftSet(json)).toEqual(
      new Map([
        ["192.168.50.101", 1500],
        ["192.168.50.102", 60],
      ]),
    );
  });

  test("handles an empty set", () => {
    const json = JSON.stringify({ nftables: [{ set: { name: "ul", elem: undefined } }] });
    expect(parseNftSet(json).size).toBe(0);
  });
});
