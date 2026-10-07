import { requireAuth } from "@g3/auth";
import {
  CLIENT_HEADER_NAMES,
  type ClientHeaders,
  type PartLookup,
} from "@g3/worker-edge/lookup-types";
import { eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createOrdersDb } from "../db";
import { lookupCache } from "../db/schema";
import type { AppEnv } from "../types";

const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
/** Query params that only track where a click came from; dropped so they don't split the cache. */
const TRACKING_PARAMS = /^(utm_\w+|ref|ref_|fbclid|gclid|mc_cid|mc_eid|_pos|_sid|_ss|_psq|_v)$/;

const urlValidator = validator("query", (value, c): { url: string } => {
  if (typeof value.url !== "string" || !value.url.trim()) {
    return c.json({ error: "Pass a product page as ?url=" }, 400) as never;
  }
  let url: URL;
  try {
    url = new URL(value.url.trim());
  } catch {
    return c.json({ error: "Not a valid URL." }, 400) as never;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return c.json({ error: "Only http(s) URLs are supported." }, 400) as never;
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  return { url: url.toString() };
});

/**
 * GET /lookup?url=<product page>: part details from a vendor link. The edge box
 * fetches the page (vendors block cloud IPs), using the requester's own browser
 * headers where a page needs to see a browser; results are cached for 7 days.
 * Requires a login so this isn't an open fetch proxy.
 */
export const lookupRouter = new Hono<AppEnv>().get("/", requireAuth, urlValidator, async (c) => {
  const { url } = c.req.valid("query");
  const db = createOrdersDb(c.env.ORDERS_DB);
  const now = Date.now();

  const cached = await db.select().from(lookupCache).where(eq(lookupCache.url, url)).get();
  if (cached && now - cached.fetchedAt < CACHE_MS) {
    return c.json({ ...(JSON.parse(cached.result) as PartLookup), fetchedAt: cached.fetchedAt });
  }

  const client: ClientHeaders = {};
  for (const [key, header] of Object.entries(CLIENT_HEADER_NAMES)) {
    const value = c.req.header(header);
    if (value) client[key as keyof ClientHeaders] = value;
  }
  const res = await c.env.EDGE.fetch(
    new Request("http://edge/api/lookup", {
      method: "POST",
      headers: { cookie: c.req.header("Cookie") ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ url, client }),
    }),
  );
  const body = (await res.json().catch(() => ({}))) as PartLookup & { error?: string };
  if (!res.ok) {
    if (res.status === 422) {
      // The box reached out fine; the vendor's site blocked it or isn't one we can read.
      return c.json(
        {
          error: `This site isn't supported for automatic lookup (${body.error ?? "it couldn't be read"}).`,
        },
        422,
      );
    }
    // Signed in here but not by Edge: the box isn't this team's (it's the site team's until each
    // team can pair its own, roadmap E.1/E.2). The requester fills the details in by hand.
    if (res.status === 401 || res.status === 403) {
      return c.json(
        { error: "Automatic lookup needs an edge box, and your team hasn't connected one." },
        503,
      );
    }
    const status = ([400, 404, 503] as const).find((s) => s === res.status) ?? 502;
    return c.json({ error: body.error ?? `Lookup failed (HTTP ${res.status}).` }, status);
  }

  await db
    .insert(lookupCache)
    .values({ url, result: JSON.stringify(body), fetchedAt: now })
    .onConflictDoUpdate({
      target: lookupCache.url,
      set: { result: JSON.stringify(body), fetchedAt: now },
    });
  c.executionCtx.waitUntil(
    db
      .delete(lookupCache)
      .where(lt(lookupCache.fetchedAt, now - CACHE_MS))
      .run(),
  );
  return c.json({ ...(body as PartLookup), fetchedAt: now });
});
