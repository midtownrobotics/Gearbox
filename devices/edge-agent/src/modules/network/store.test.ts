// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from "bun:test";
import { openDb } from "../../core/db";
import { UsageStore } from "./store";

const lease = { mac: "aa:aa:aa:aa:aa:01", ip: "192.168.50.101", hostname: "laptop" };

function record(store: UsageStore, bucket: number, dl: number) {
  store.record({
    ts: bucket + 300,
    bootId: "boot",
    counters: new Map([["dl:192.168.50.101", dl]]),
    bucket,
    usage: new Map([[lease.mac, { dl, ul: 0 }]]),
    leases: [lease],
  });
}

describe("UsageStore", () => {
  test("adds to a bucket and marks it unsent again when it changes", () => {
    const store = new UsageStore(openDb(":memory:"));
    record(store, 0, 100);
    const [row] = store.unsent(10);
    expect(row).toEqual({ ts: 0, mac: lease.mac, dl: 100, ul: 0 });

    store.markSent([row]);
    expect(store.unsentCount()).toBe(0);

    record(store, 0, 50);
    expect(store.unsent(10)).toEqual([{ ts: 0, mac: lease.mac, dl: 150, ul: 0 }]);
  });

  test("does not mark a row sent if it changed during the push", () => {
    const store = new UsageStore(openDb(":memory:"));
    record(store, 0, 100);
    const rows = store.unsent(10);
    record(store, 0, 25);
    store.markSent(rows);
    expect(store.unsent(10)).toEqual([{ ts: 0, mac: lease.mac, dl: 125, ul: 0 }]);
  });

  test("remembers the last reading and client info", () => {
    const store = new UsageStore(openDb(":memory:"));
    expect(store.lastReading()).toBeNull();
    record(store, 300, 10);
    expect(store.lastReading()).toEqual({
      ts: 600,
      bootId: "boot",
      counters: new Map([["dl:192.168.50.101", 10]]),
    });
    expect(store.clients([lease.mac, "ip:192.168.50.9"])).toEqual([
      { mac: lease.mac, hostname: "laptop", ip: "192.168.50.101" },
      { mac: "ip:192.168.50.9", hostname: null, ip: "192.168.50.9" },
    ]);
  });
});
