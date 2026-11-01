// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test";
import { attribute, bucketFor, counterDeltas } from "./deltas";

const m = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("counterDeltas", () => {
  test("subtracts previous values", () => {
    expect(counterDeltas(m({ a: 100, b: 50 }), m({ a: 150, b: 50 }))).toEqual(m({ a: 50 }));
  });

  test("treats a lower value as a counter reset", () => {
    expect(counterDeltas(m({ a: 1000 }), m({ a: 30 }))).toEqual(m({ a: 30 }));
  });

  test("counts new keys from zero", () => {
    expect(counterDeltas(m({}), m({ a: 70 }))).toEqual(m({ a: 70 }));
  });

  test("reset flag counts every value in full", () => {
    expect(counterDeltas(m({ a: 10, b: 5 }), m({ a: 20, b: 7 }), true)).toEqual(m({ a: 20, b: 7 }));
  });
});

describe("attribute", () => {
  const leases = [{ mac: "aa:aa:aa:aa:aa:01", ip: "192.168.50.101", hostname: "x" }];

  test("maps IPs to MACs and WAN counters to _wan", () => {
    const out = attribute(
      m({
        "dl:192.168.50.101": 500,
        "ul:192.168.50.101": 40,
        "dl:192.168.50.150": 7,
        "wan:rx": 600,
        "wan:tx": 50,
      }),
      leases,
    );
    expect(out).toEqual(
      new Map([
        ["aa:aa:aa:aa:aa:01", { dl: 500, ul: 40 }],
        ["ip:192.168.50.150", { dl: 7, ul: 0 }],
        ["_wan", { dl: 600, ul: 50 }],
      ]),
    );
  });
});

describe("bucketFor", () => {
  test("a reading just after a boundary goes in the bucket that ended", () => {
    expect(bucketFor(1_800_000_005, 1_800_000_305)).toBe(1_800_000_000);
  });

  test("short intervals land in the current bucket", () => {
    expect(bucketFor(1_800_000_100, 1_800_000_110)).toBe(1_800_000_000);
  });
});
