import { type WorkerClient, desiredVersion } from "../../core/worker-client";
import type { SiteStore } from "./site-store";
import type { UsageStore } from "./store";

const BATCH_SIZE = 500;
const MIN_RETRY_SECONDS = 30;
const MAX_RETRY_SECONDS = 30 * 60;

/** Site usage is pushed per finished hour, keeping each client's top sites. */
const SITE_HOURS_PER_BATCH = 6;
const TOP_SITES_PER_CLIENT_HOUR = 20;
/** An hour counts as finished a little after it ends, once the last reading has landed. */
const HOUR_SETTLE_SECONDS = 3600 + 600;

/**
 * Uploads unsent usage buckets and finished site-usage hours to the worker. On
 * failure it retries with exponential backoff; the next collection also triggers a push.
 */
export class Pusher {
  private inFlight: Promise<void> | null = null;
  private retryTimer: Timer | null = null;
  private failures = 0;
  lastSuccessAt: number | null = null;
  lastError: string | null = null;

  constructor(
    private store: UsageStore,
    private sites: SiteStore,
    private worker: WorkerClient,
    /** Called with the desired-state version from each worker response. */
    private onStateVersion: (version: number) => void = () => {},
  ) {}

  flush(): Promise<void> {
    this.inFlight ??= this.send().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  stop() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private async send() {
    this.stop();
    try {
      await this.sendUsage();
      await this.sendSites();
      this.failures = 0;
      this.lastError = null;
      this.lastSuccessAt = Math.floor(Date.now() / 1000);
    } catch (err) {
      this.failures += 1;
      this.lastError = err instanceof Error ? err.message : String(err);
      const delay = Math.min(MAX_RETRY_SECONDS, MIN_RETRY_SECONDS * 2 ** (this.failures - 1));
      console.warn(`[network] push failed (${this.lastError}); retrying in ${delay}s`);
      this.retryTimer = setTimeout(() => void this.flush(), delay * 1000);
    }
  }

  private async sendUsage() {
    for (;;) {
      const rows = this.store.unsent(BATCH_SIZE);
      if (rows.length === 0) return;
      // "_wan", "_lookup", ...: pseudo-clients with no lease info.
      const macs = [...new Set(rows.map((r) => r.mac))].filter((m) => !m.startsWith("_"));
      const res = await this.worker.agent.network.usage.$post({
        json: {
          samples: rows.map((r) => [r.ts, r.mac, r.dl, r.ul]),
          clients: this.store.clients(macs),
        },
      });
      if (!res.ok) throw new Error(`usage push: worker returned HTTP ${res.status}`);
      this.onStateVersion(desiredVersion(res));
      this.store.markSent(rows);
      if (rows.length < BATCH_SIZE) return;
    }
  }

  private async sendSites() {
    const before = Math.floor(Date.now() / 1000) - HOUR_SETTLE_SECONDS;
    for (;;) {
      const hours = this.sites.unsentHours(before, SITE_HOURS_PER_BATCH);
      if (hours.length === 0) return;
      const res = await this.worker.agent.network.sites.$post({
        json: { rows: this.sites.rowsFor(hours, TOP_SITES_PER_CLIENT_HOUR) },
      });
      if (!res.ok) throw new Error(`sites push: worker returned HTTP ${res.status}`);
      this.onStateVersion(desiredVersion(res));
      this.sites.markHoursSent(hours);
    }
  }
}
