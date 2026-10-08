import { describe, expect, test } from "bun:test";
import { attribute } from "./deltas";
import {
  type Neighbor,
  ONLINE_SECONDS,
  PresenceTracker,
  knownDevices,
  parseNeighbors,
} from "./presence";

describe("parseNeighbors", () => {
  test("reads `ip -j neigh` and skips IPv6 and junk", () => {
    const json = JSON.stringify([
      { dst: "192.168.50.20", dev: "lan0", lladdr: "AA:BB:CC:00:00:20", state: ["REACHABLE"] },
      { dst: "192.168.50.30", dev: "lan0", state: ["FAILED"] },
      { dst: "fe80::1", dev: "lan0", lladdr: "aa:bb:cc:00:00:99", state: ["STALE"] },
      { nope: true },
    ]);
    expect(parseNeighbors(json)).toEqual([
      { ip: "192.168.50.20", mac: "aa:bb:cc:00:00:20", state: ["REACHABLE"] },
      { ip: "192.168.50.30", mac: null, state: ["FAILED"] },
    ]);
    expect(parseNeighbors("")).toEqual([]);
  });
});

describe("PresenceTracker", () => {
  const printer = "02:00:00:00:00:10";
  const phone = "02:00:00:00:00:03";

  function setup(table: Neighbor[]) {
    let t = 1_000_000;
    const probed: string[][] = [];
    const tracker = new PresenceTracker(
      {
        leases: async () => [{ mac: phone, ip: "192.168.50.103", hostname: "phone" }],
        neighbors: async () => table,
        probe: async (ips) => void probed.push(ips),
      },
      () => t,
    );
    return {
      tracker,
      probed,
      advance: (s: number) => {
        t += s;
      },
    };
  }

  test("counts devices that answer, even ones with no lease or traffic", async () => {
    const { tracker, probed } = setup([
      { ip: "192.168.50.20", mac: printer, state: ["REACHABLE"] },
      { ip: "192.168.50.103", mac: phone, state: ["STALE"] },
    ]);
    const res = await tracker.check(0);
    expect(probed[0].sort()).toEqual(["192.168.50.103", "192.168.50.20"]);
    expect(res.clients).toEqual([
      {
        mac: printer,
        ip: "192.168.50.20",
        hostname: null,
        online: true,
        lastConfirmedAt: 1_000_000,
      },
      { mac: phone, ip: "192.168.50.103", hostname: "phone", online: false, lastConfirmedAt: null },
    ]);
  });

  test("a device stays online for a while after its entry goes stale, then drops off", async () => {
    const table: Neighbor[] = [{ ip: "192.168.50.20", mac: printer, state: ["REACHABLE"] }];
    const { tracker, advance } = setup(table);
    await tracker.check(0);
    table[0] = { ...table[0], state: ["STALE"] };
    advance(ONLINE_SECONDS);
    expect((await tracker.check(0)).clients[0].online).toBe(true);
    advance(1);
    expect((await tracker.check(0)).clients[0]).toMatchObject({
      online: false,
      lastConfirmedAt: 1_000_000,
    });
  });
});

describe("knownDevices", () => {
  const lease = { mac: "aa:aa:aa:aa:aa:01", ip: "192.168.50.101", hostname: "laptop" };
  const printer: Neighbor = { ip: "192.168.50.9", mac: "bb:bb:bb:bb:bb:09", state: ["STALE"] };

  test("adds fixed-IP devices from the neighbor table, so they're matched by MAC", () => {
    const devices = knownDevices([lease], [printer]);
    expect(devices).toContainEqual({
      mac: "bb:bb:bb:bb:bb:09",
      ip: "192.168.50.9",
      hostname: null,
    });
    expect(devices).toContainEqual(lease);
    // Their usage goes to the MAC, the key who's online uses, not "ip:192.168.50.9".
    const usage = attribute(new Map([["dl:192.168.50.9", 500]]), devices);
    expect([...usage.keys()]).toEqual(["bb:bb:bb:bb:bb:09"]);
  });

  test("trusts the table over a lease for who has an address now, keeping the hostname", () => {
    const moved: Neighbor = { ip: "192.168.50.150", mac: lease.mac, state: ["REACHABLE"] };
    const taken: Neighbor = { ip: lease.ip, mac: "cc:cc:cc:cc:cc:03", state: ["REACHABLE"] };
    const devices = knownDevices([lease], [moved, taken]);
    expect(devices).toContainEqual({ mac: lease.mac, ip: "192.168.50.150", hostname: "laptop" });
    expect(devices).toContainEqual({ mac: "cc:cc:cc:cc:cc:03", ip: lease.ip, hostname: null });
    expect(devices).toHaveLength(2);
  });

  test("skips table entries with no MAC and keeps leases the table doesn't know", () => {
    const unresolved: Neighbor = { ip: "192.168.50.30", mac: null, state: ["FAILED"] };
    expect(knownDevices([lease], [unresolved])).toEqual([lease]);
  });
});
