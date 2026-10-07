/**
 * Wire types for the agent's live "who's on the LAN" check (GET /network/presence),
 * read from the box's neighbor (ARP) table, so it includes devices that never
 * use the internet (printers, robot radios).
 */

export interface PresenceClient {
  mac: string;
  ip: string;
  /** From the DHCP lease; null for static-IP devices or ones that sent no name. */
  hostname: string | null;
  /** Answered the box within the last couple of minutes. */
  online: boolean;
  /** Last time the box confirmed it was there (unix seconds); null if not since the agent started. */
  lastConfirmedAt: number | null;
}

export interface PresenceResponse {
  /** When the box read its neighbor table (unix seconds). */
  checkedAt: number;
  clients: PresenceClient[];
}
