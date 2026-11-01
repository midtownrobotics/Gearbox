// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getMeta, setMeta } from "../../core/db";
import type { ModuleContext } from "../../core/module";
import {
  type NetConfig,
  type NetworkState,
  TABLE,
  buildDnsmasqConf,
  buildGrantRefresh,
  buildTable,
  tableKey,
} from "./enforce";
import { nft } from "./nft";
import type { Lease } from "./parse";

/** Where enforcement changes go: the real system, or files for inspection in mock mode. */
export interface EnforcementTarget {
  applyNft(script: string): Promise<void>;
  tableExists(): Promise<boolean>;
  /** Writes the dnsmasq config if it changed. Returns true if it was written. */
  writeDnsmasqConf(content: string): Promise<boolean>;
}

async function readText(path: string) {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : null;
}

/**
 * The live system. The dnsmasq config is written to the agent's state
 * directory; a systemd path unit (g3-edge-dnsmasq.path) restarts dnsmasq
 * when it changes, so the agent needs no privileges for that.
 */
export function systemTarget(dnsmasqConfPath: string): EnforcementTarget {
  return {
    async applyNft(script) {
      await nft(["-f", "-"], script);
    },
    async tableExists() {
      try {
        await nft(["list", "table", ...TABLE.split(" ")]);
        return true;
      } catch {
        return false;
      }
    },
    async writeDnsmasqConf(content) {
      if ((await readText(dnsmasqConfPath)) === content) return false;
      mkdirSync(dirname(dnsmasqConfPath), { recursive: true });
      // Not *.conf, so dnsmasq's conf-dir ignores it until it's validated and renamed.
      const tmp = `${dnsmasqConfPath}.new`;
      writeFileSync(tmp, content);
      const dnsmasq = Bun.which("dnsmasq") ?? Bun.which("/usr/sbin/dnsmasq");
      if (dnsmasq) {
        const check = Bun.spawnSync([dnsmasq, "--test", `--conf-file=${tmp}`], { stderr: "pipe" });
        if (check.exitCode !== 0) {
          throw new Error(`generated dnsmasq config is invalid: ${check.stderr.toString().trim()}`);
        }
      }
      renameSync(tmp, dnsmasqConfPath);
      return true;
    },
  };
}

/** Mock mode: writes what would be applied to files next to the agent database. */
export function fileTarget(dir: string, dnsmasqConfPath: string): EnforcementTarget {
  let exists = false;
  return {
    async applyNft(script) {
      mkdirSync(dir, { recursive: true });
      const name = script.startsWith(`table ${TABLE}`) ? "g3-table.nft" : "g3-grants.nft";
      writeFileSync(join(dir, name), script);
      if (name === "g3-table.nft") exists = true;
    },
    async tableExists() {
      return exists;
    },
    async writeDnsmasqConf(content) {
      if ((await readText(dnsmasqConfPath)) === content) return false;
      mkdirSync(dirname(dnsmasqConfPath), { recursive: true });
      writeFileSync(dnsmasqConfPath, content);
      return true;
    },
  };
}

/**
 * Applies the desired network state (blocklists, grants, DNS hardening) and
 * keeps it applied. The last state fetched is saved locally, so enforcement
 * continues across restarts and without internet.
 */
export class Enforcer {
  private state: NetworkState | null = null;
  private appliedTableKey: string | null = null;
  private syncing: Promise<void> | null = null;
  private syncAgain = false;
  lastSyncAt: number | null = null;
  lastSyncError: string | null = null;
  lastApplyError: string | null = null;

  constructor(
    private ctx: ModuleContext,
    private target: EnforcementTarget,
    private leases: () => Promise<Lease[]>,
  ) {
    const saved = getMeta(ctx.db, "network_state");
    if (saved) this.state = JSON.parse(saved) as NetworkState;
  }

  private get net(): NetConfig {
    const { lanInterface, wanInterface, lanIp } = this.ctx.config;
    return { lanInterface, wanInterface, lanIp };
  }

  /** Re-applies the last-known state (at startup and every collection). */
  async ensure() {
    if (this.state) await this.apply(this.state);
  }

  /** Fetches the desired state from the worker and applies it. Concurrent calls coalesce. */
  sync(): Promise<void> {
    if (this.syncing) {
      this.syncAgain = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      do {
        this.syncAgain = false;
        try {
          await this.fetchAndApply();
          this.lastSyncError = null;
        } catch (err) {
          this.lastSyncError = err instanceof Error ? err.message : String(err);
          console.error(`[network] sync failed: ${this.lastSyncError}`);
        }
      } while (this.syncAgain);
    })().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async fetchAndApply() {
    const res = await this.ctx.worker.agent.network.state.$get();
    if (!res.ok) throw new Error(`state fetch: worker returned HTTP ${res.status}`);
    const state: NetworkState = await res.json();
    await this.apply(state);
    this.state = state;
    setMeta(this.ctx.db, "network_state", JSON.stringify(state));
    this.ctx.sync.applied = state.version;
    setMeta(this.ctx.db, "applied_state_version", String(state.version));
    this.lastSyncAt = Math.floor(Date.now() / 1000);
    // Tell the worker right away, so the UI stops showing the change as pending.
    await this.ctx.worker.agent.ack.$post().catch(() => {});
  }

  private async apply(state: NetworkState) {
    try {
      const key = tableKey(state, this.net);
      if (key !== this.appliedTableKey || !(await this.target.tableExists())) {
        await this.target.applyNft(buildTable(state, this.net));
        this.appliedTableKey = key;
      }
      const macToIp = new Map((await this.leases()).map((l) => [l.mac, l.ip]));
      const grants = buildGrantRefresh(state, macToIp, Math.floor(Date.now() / 1000));
      if (grants) await this.target.applyNft(grants);
      // After the table, so dnsmasq's nftset targets exist when it restarts.
      if (await this.target.writeDnsmasqConf(buildDnsmasqConf(state, this.net))) {
        console.log("[network] dnsmasq config updated");
      }
      this.lastApplyError = null;
    } catch (err) {
      this.lastApplyError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  status() {
    return {
      appliedStateVersion: this.ctx.sync.applied,
      enforce: this.state?.enforce ?? false,
      dnsHardening: this.state?.dnsHardening ?? false,
      blocklists: this.state?.blocklists.length ?? 0,
      activeGrants: this.state?.grants.filter((g) => g.expiresAt > Date.now() / 1000).length ?? 0,
      lastSyncAt: this.lastSyncAt,
      lastSyncError: this.lastSyncError,
      lastApplyError: this.lastApplyError,
    };
  }
}
