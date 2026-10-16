import { describe, expect, test } from "bun:test";
import { parseInterface } from "./interfaces";

describe("parseInterface", () => {
  test("keeps global IPv4 and IPv6 addresses, not link-local", () => {
    const json = JSON.stringify([
      {
        ifname: "wan0",
        operstate: "UP",
        address: "AA:BB:CC:00:00:01",
        addr_info: [
          { family: "inet", local: "192.168.0.23", prefixlen: 24, scope: "global" },
          { family: "inet6", local: "2001:db8::23", prefixlen: 64, scope: "global" },
          { family: "inet6", local: "fe80::1", prefixlen: 64, scope: "link" },
        ],
      },
    ]);
    expect(parseInterface(json, "wan", "wan0")).toEqual({
      role: "wan",
      name: "wan0",
      state: "up",
      mac: "aa:bb:cc:00:00:01",
      addresses: [
        { address: "192.168.0.23", prefixLength: 24, family: "ipv4" },
        { address: "2001:db8::23", prefixLength: 64, family: "ipv6" },
      ],
    });
  });

  test("a missing interface has no state or addresses", () => {
    expect(parseInterface("[]", "lan", "lan0")).toEqual({
      role: "lan",
      name: "lan0",
      state: null,
      mac: null,
      addresses: [],
    });
  });
});
