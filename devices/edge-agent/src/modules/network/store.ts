// SPDX-License-Identifier: AGPL-3.0-only
import type { Database } from "bun:sqlite";
import type { Counters, Usage } from "./deltas";
import type { Lease } from "./parse";

export interface UsageRow {
  ts: number;
  mac: string;
  dl: number;
  ul: number;
}

export interface ClientRow {
  mac: string;
  hostname: string | null;
  ip: string | null;
}

/**
 * Local buffer for the network module: last counter readings, usage buckets
 * waiting to be pushed, and the latest lease info per MAC.
 */
export class UsageStore {
  constructor(private db: Database) {
    db.run(`CREATE TABLE IF NOT EXISTS net_counters (
      key TEXT PRIMARY KEY, value INTEGER NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS net_reading (
      id INTEGER PRIMARY KEY CHECK (id = 1), ts INTEGER NOT NULL, boot_id TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS net_usage (
      ts INTEGER NOT NULL, mac TEXT NOT NULL, dl INTEGER NOT NULL, ul INTEGER NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ts, mac))`);
    db.run("CREATE INDEX IF NOT EXISTS idx_net_usage_unsent ON net_usage (sent, ts)");
    db.run(`CREATE TABLE IF NOT EXISTS net_clients (
      mac TEXT PRIMARY KEY, hostname TEXT, ip TEXT, updated_at INTEGER NOT NULL)`);
  }

  lastReading(): { ts: number; bootId: string; counters: Counters } | null {
    const row = this.db
      .query<{ ts: number; boot_id: string }, []>(
        "SELECT ts, boot_id FROM net_reading WHERE id = 1",
      )
      .get();
    if (!row) return null;
    const counters = this.db
      .query<{ key: string; value: number }, []>("SELECT key, value FROM net_counters")
      .all();
    return {
      ts: row.ts,
      bootId: row.boot_id,
      counters: new Map(counters.map((c) => [c.key, c.value])),
    };
  }

  /**
   * Saves a reading and adds its usage to the bucket, atomically. A bucket that
   * changes is marked unsent again so the worker gets the new total.
   */
  record(args: {
    ts: number;
    bootId: string;
    counters: Counters;
    bucket: number | null;
    usage: Map<string, Usage>;
    leases: Lease[];
  }) {
    const { ts, bootId, counters, bucket, usage, leases } = args;
    const addUsage = this.db.query(
      `INSERT INTO net_usage (ts, mac, dl, ul) VALUES (?, ?, ?, ?)
       ON CONFLICT (ts, mac) DO UPDATE SET dl = dl + excluded.dl, ul = ul + excluded.ul, sent = 0`,
    );
    const putCounter = this.db.query("INSERT INTO net_counters (key, value) VALUES (?, ?)");
    const putClient = this.db.query(
      `INSERT INTO net_clients (mac, hostname, ip, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (mac) DO UPDATE SET
         hostname = coalesce(excluded.hostname, hostname), ip = excluded.ip, updated_at = excluded.updated_at`,
    );
    this.db.transaction(() => {
      if (bucket !== null) {
        for (const [mac, u] of usage) addUsage.run(bucket, mac, u.dl, u.ul);
      }
      this.db.run("DELETE FROM net_counters");
      for (const [key, value] of counters) putCounter.run(key, value);
      this.db
        .query(
          `INSERT INTO net_reading (id, ts, boot_id) VALUES (1, ?, ?)
           ON CONFLICT (id) DO UPDATE SET ts = excluded.ts, boot_id = excluded.boot_id`,
        )
        .run(ts, bootId);
      for (const l of leases) putClient.run(l.mac, l.hostname, l.ip, ts);
    })();
  }

  unsent(limit: number): UsageRow[] {
    return this.db
      .query<UsageRow, [number]>(
        "SELECT ts, mac, dl, ul FROM net_usage WHERE sent = 0 ORDER BY ts LIMIT ?",
      )
      .all(limit);
  }

  unsentCount() {
    return (
      this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM net_usage WHERE sent = 0").get()
        ?.n ?? 0
    );
  }

  /** Marks rows sent, unless they changed while the push was in flight. */
  markSent(rows: UsageRow[]) {
    const mark = this.db.query(
      "UPDATE net_usage SET sent = 1 WHERE ts = ? AND mac = ? AND dl = ? AND ul = ?",
    );
    this.db.transaction(() => {
      for (const r of rows) mark.run(r.ts, r.mac, r.dl, r.ul);
    })();
  }

  clients(macs: string[]): ClientRow[] {
    const get = this.db.query<ClientRow, [string]>(
      "SELECT mac, hostname, ip FROM net_clients WHERE mac = ?",
    );
    return macs.flatMap((mac) => {
      if (mac.startsWith("ip:")) return [{ mac, hostname: null, ip: mac.slice(3) }];
      const row = get.get(mac);
      return row ? [row] : [];
    });
  }

  /** Drops already-pushed rows; the worker is the long-term store. */
  prune(olderThan: number) {
    this.db.query("DELETE FROM net_usage WHERE sent = 1 AND ts < ?").run(olderThan);
  }
}
