import { requireAuth } from "@g3/auth";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { AgentError, agentFetch } from "../../lib/agent";
import type { AppEnv } from "../../types";
import type { ClientHeaders, LookupRequest, PartLookup } from "./types";

const lookupValidator = validator("json", (value, c): LookupRequest => {
  const v = (value ?? {}) as { url?: unknown; client?: unknown };
  if (typeof v.url !== "string" || !v.url.trim()) {
    return c.json({ error: "url is required." }, 400) as never;
  }
  const client: ClientHeaders = {};
  if (v.client && typeof v.client === "object") {
    for (const [key, val] of Object.entries(v.client)) {
      if (typeof val === "string" && val.length <= 500) client[key as keyof ClientHeaders] = val;
    }
  }
  return { url: v.url.trim(), client };
});

/**
 * Part lookup from the edge box (called by the orders worker). The box fetches
 * the vendor page, so vendors see the shop's connection, not a Workers IP.
 * Nothing is cached here; the orders worker caches results.
 */
export const lookupRouter = new Hono<AppEnv>().post(
  "/",
  requireAuth,
  lookupValidator,
  async (c) => {
    try {
      const res = await agentFetch(c.env, c.get("teamId"), "/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c.req.valid("json")),
        // Vendor fetches time out after 10 s each on the box; a lookup can chain a few.
        timeoutMs: 30_000,
      });
      const body = (await res.json().catch(() => ({}))) as PartLookup & { error?: string };
      if (!res.ok) {
        // 422: the box is fine but the vendor's site couldn't be read.
        const status = ([400, 404, 422] as const).find((s) => s === res.status) ?? 502;
        return c.json({ error: body.error ?? `Lookup failed (HTTP ${res.status}).` }, status);
      }
      return c.json(body as PartLookup);
    } catch (err) {
      if (err instanceof AgentError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  },
);
