import { describe, expect, test } from "bun:test";
import { type Neighbor, ONLINE_SECONDS, PresenceTracker, parseNeighbors } from "./presence";

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
