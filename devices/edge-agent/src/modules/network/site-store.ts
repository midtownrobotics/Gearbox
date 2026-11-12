// SPDX-License-Identifier: AGPL-3.0-only
import type { Database } from "bun:sqlite";
import type { Counters, Usage } from "./deltas";
import type { DnsAnswer } from "./parse";
import { OTHER_SITE } from "./sites";

/** DNS answers are used for attribution this long after they were seen. */
const DNS_MEMORY_SECONDS = 24 * 3600;

export type SiteRow = [ts: number, mac: string, site: string, dl: number, ul: number];

/**
 * Local state for per-site tracking: last flow counter readings, recent DNS
 * answers per client, and hourly per-client per-site usage waiting to be pushed.
 */
export class SiteStore {
  constructor(private db: Database) {
    db.run(
      "CREATE TABLE IF NOT EXISTS net_flow_counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL)",
    );
    db.run(`CREATE TABLE IF NOT EXISTS net_flow_reading (
      id INTEGER PRIMARY KEY CHECK (id = 1), ts INTEGER NOT NULL, boot_id TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS net_dns (
      client TEXT NOT NULL, ip TEXT NOT NULL, name TEXT NOT NULL, seen_at INTEGER NOT NULL,
      PRIMARY KEY (client, ip))`);
    db.run("CREATE INDEX IF NOT EXISTS idx_net_dns_ip ON net_dns (ip, seen_at)");
    db.run(`CREATE TABLE IF NOT EXISTS net_site_usage (
      ts INTEGER NOT NULL, mac TEXT NOT NULL, site TEXT NOT NULL,
      dl INTEGER NOT NULL, ul INTEGER NOT NULL, sent INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ts, mac, site))`);
    db.run("CREATE INDEX IF NOT EXISTS idx_net_site_usage_unsent ON net_site_usage (sent, ts)");
  }

  recordDns(answers: DnsAnswer[], ts: number) {
    const put = this.db.query(
      `INSERT INTO net_dns (client, ip, name, seen_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (client, ip) DO UPDATE SET name = excluded.name, seen_at = excluded.seen_at`,
    );
    this.db.transaction(() => {
      for (const a of answers) put.run(a.client, a.ip, a.name, ts);
      this.db.query("DELETE FROM net_dns WHERE seen_at < ?").run(ts - DNS_MEMORY_SECONDS);
    })();
  }

  /** The name this client looked up for `ip`, else the latest anyone looked up. */
  nameFor(client: string, ip: string): string | null {
    const own = this.db
      .query<{ name: string }, [string, string]>(
        "SELECT name FROM net_dns WHERE client = ? AND ip = ?",
      )
      .get(client, ip);
    if (own) return own.name;
    return (
      this.db
        .query<{ name: string }, [string]>(
          "SELECT name FROM net_dns WHERE ip = ? ORDER BY seen_at DESC LIMIT 1",
        )
        .get(ip)?.name ?? null
    );
  }

  lastFlows(): { ts: number; bootId: string; counters: Counters } | null {
    const row = this.db
      .query<{ ts: number; boot_id: string }, []>(
        "SELECT ts, boot_id FROM net_flow_reading WHERE id = 1",
      )
      .get();
    if (!row) return null;
    const rows = this.db
      .query<{ key: string; value: number }, []>("SELECT key, value FROM net_flow_counters")
      .all();
    return {
      ts: row.ts,
      bootId: row.boot_id,
      counters: new Map(rows.map((r) => [r.key, r.value])),
    };
  }

  /** Saves the flow reading and adds usage to the hour's rows, atomically. */
  record(args: {
    ts: number;
    bootId: string;
    counters: Counters;
    hour: number | null;
    usage: Map<string, Map<string, Usage>>;
  }) {
    const add = this.db.query(
      `INSERT INTO net_site_usage (ts, mac, site, dl, ul) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (ts, mac, site) DO UPDATE SET dl = dl + excluded.dl, ul = ul + excluded.ul, sent = 0`,
    );
    const putCounter = this.db.query("INSERT INTO net_flow_counters (key, value) VALUES (?, ?)");
    this.db.transaction(() => {
      if (args.hour !== null) {
        for (const [mac, sites] of args.usage) {
          for (const [site, u] of sites) add.run(args.hour, mac, site, u.dl, u.ul);
        }
      }
      this.db.run("DELETE FROM net_flow_counters");
      for (const [key, value] of args.counters) putCounter.run(key, value);
      this.db
        .query(
          `INSERT INTO net_flow_reading (id, ts, boot_id) VALUES (1, ?, ?)
           ON CONFLICT (id) DO UPDATE SET ts = excluded.ts, boot_id = excluded.boot_id`,
        )
        .run(args.ts, args.bootId);
    })();
  }

  /** Hours that are finished and not yet pushed. */
  unsentHours(before: number, limit: number): number[] {
    return this.db
      .query<{ ts: number }, [number, number]>(
        "SELECT DISTINCT ts FROM net_site_usage WHERE sent = 0 AND ts < ? ORDER BY ts LIMIT ?",
      )
      .all(before, limit)
      .map((r) => r.ts);
  }

  /** Rows for the given hours: each client's top `topN` sites, the rest summed as "(other)". */
  rowsFor(hours: number[], topN: number): SiteRow[] {
    const placeholders = hours.map(() => "?").join(",");
    return this.db
      .query<
        { ts: number; mac: string; site: string; dl: number; ul: number },
        (string | number)[]
      >(
        `WITH ranked AS (
           SELECT ts, mac, site, dl, ul,
             ROW_NUMBER() OVER (PARTITION BY ts, mac ORDER BY dl + ul DESC) AS rn
           FROM net_site_usage WHERE ts IN (${placeholders}))
         SELECT ts, mac, CASE WHEN rn <= ? THEN site ELSE ? END AS site, SUM(dl) AS dl, SUM(ul) AS ul
         FROM ranked GROUP BY ts, mac, 3 ORDER BY ts, mac`,
      )
      .all(...hours, topN, OTHER_SITE)
      .map((r) => [r.ts, r.mac, r.site, r.dl, r.ul]);
  }

  markHoursSent(hours: number[]) {
    const mark = this.db.query("UPDATE net_site_usage SET sent = 1 WHERE ts = ?");
    this.db.transaction(() => {
      for (const h of hours) mark.run(h);
    })();
  }

  prune(olderThan: number) {
    this.db.query("DELETE FROM net_site_usage WHERE sent = 1 AND ts < ?").run(olderThan);
  }
}
