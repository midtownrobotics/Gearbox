import type { BoxAddress, BoxInterface } from "@g3/worker-edge/interface-types";

type IpAddrEntry = {
  ifname?: unknown;
  operstate?: unknown;
  address?: unknown;
  addr_info?: { family?: unknown; local?: unknown; prefixlen?: unknown; scope?: unknown }[];
};

/**
 * Parses `ip -j addr show dev <name>` into one interface. Only global
 * addresses are kept: link-local ones (fe80::) mean nothing off the box.
 */
export function parseInterface(json: string, role: BoxInterface["role"], name: string) {
  const doc = JSON.parse(json || "[]") as unknown;
  const entry = (Array.isArray(doc) ? doc : []).find((e: IpAddrEntry) => e?.ifname === name) as
    | IpAddrEntry
    | undefined;
  const addresses: BoxAddress[] = [];
  for (const a of entry?.addr_info ?? []) {
    if (a?.scope !== "global" || typeof a.local !== "string") continue;
    if (a.family !== "inet" && a.family !== "inet6") continue;
    addresses.push({
      address: a.local,
      prefixLength: typeof a.prefixlen === "number" ? a.prefixlen : 0,
      family: a.family === "inet" ? "ipv4" : "ipv6",
    });
  }
  return {
    role,
    name,
    state: typeof entry?.operstate === "string" ? entry.operstate.toLowerCase() : null,
    mac: typeof entry?.address === "string" ? entry.address.toLowerCase() : null,
    addresses,
  } satisfies BoxInterface;
}

/** Reads one interface's addresses; a missing interface comes back with state null. */
export async function readInterface(role: BoxInterface["role"], name: string) {
  const proc = Bun.spawn(["ip", "-j", "addr", "show", "dev", name], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return parseInterface(code === 0 ? out : "[]", role, name);
}
