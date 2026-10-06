/** Wire types for the agent's GET /network/interfaces: the box's own addresses. */

export interface BoxAddress {
  /** e.g. "192.168.50.1" or "2607:fb90::1". */
  address: string;
  prefixLength: number;
  family: "ipv4" | "ipv6";
}

export interface BoxInterface {
  /** "lan" (the shop network) or "wan" (the hotspot). */
  role: "lan" | "wan";
  /** Linux name, e.g. "lan0". */
  name: string;
  /** Kernel operstate: "up", "down", "unknown", ... null if the interface is missing. */
  state: string | null;
  mac: string | null;
  /** Global addresses only (no link-local). */
  addresses: BoxAddress[];
}

export interface InterfacesResponse {
  checkedAt: number;
  interfaces: BoxInterface[];
}
