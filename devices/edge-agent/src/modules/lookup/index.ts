import { LOOKUP_USAGE_KEY, type LookupRequest } from "@g3/worker-edge/lookup-types";
import { Hono } from "hono";
import type { EdgeModule, ModuleContext } from "../../core/module";
import { LookupError, lookupPart, meterLookups } from "./part-lookup";

/** Same 5-minute buckets as the network module's usage. */
const BUCKET_SECONDS = 300;

/**
 * Part lookup module: fetches vendor product pages from the box, so vendors see
 * the shop's connection instead of a cloud IP that many of them block. The orders
 * worker caches results for a week, so each product crosses the hotspot rarely.
 */
export function createLookupModule(ctx: ModuleContext): EdgeModule {
  const { digikeyClientId, digikeyClientSecret } = ctx.config;
  const digikey =
    digikeyClientId && digikeyClientSecret
      ? { clientId: digikeyClientId, clientSecret: digikeyClientSecret }
      : undefined;
  let lookups = 0;
  let lastError: string | null = null;
  let bytesSinceStart = 0;

  // Lookup traffic goes into the network module's usage buckets (it owns net_usage and pushes
  // every unsent row), under "_lookup", so the dashboard can show what lookups cost the hotspot.
  const addUsage = ctx.db.query(
    `INSERT INTO net_usage (ts, mac, dl, ul) VALUES (?, ?, ?, ?)
     ON CONFLICT (ts, mac) DO UPDATE SET dl = dl + excluded.dl, ul = ul + excluded.ul, sent = 0`,
  );
  meterLookups((dl, ul) => {
    const bucket = Math.floor(Date.now() / 1000 / BUCKET_SECONDS) * BUCKET_SECONDS;
    addUsage.run(bucket, LOOKUP_USAGE_KEY, dl, ul);
    bytesSinceStart += dl + ul;
  });

  const routes = new Hono().post("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as LookupRequest | null;
    if (!body || typeof body.url !== "string") return c.json({ error: "url is required." }, 400);
    lookups++;
    try {
      const result = await lookupPart(body.url, { digikey, client: body.client });
      lastError = null;
      return c.json(result);
    } catch (err) {
      if (err instanceof LookupError) {
        // The vendor's site failed or blocked us: 422, never 502, which the edge worker
        // (rightly) reads as "the tunnel is up but the agent isn't answering".
        return c.json({ error: err.message }, err.status === 502 ? 422 : err.status);
      }
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[lookup] ${body.url}: ${lastError}`);
      return c.json({ error: `Lookup failed: ${lastError}` }, 500);
    }
  });

  return {
    name: "lookup",
    routes,
    start() {},
    stop() {
      meterLookups(null);
    },
    status() {
      return { lookups, bytesSinceStart, digikey: digikey !== undefined, lastError };
    },
  };
}
