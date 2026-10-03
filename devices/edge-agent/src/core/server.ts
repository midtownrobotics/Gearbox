import { Hono } from "hono";
import { bearerMatches } from "./key";
import type { EdgeModule } from "./module";
import { AGENT_VERSION } from "./version";

/**
 * Local HTTP API, bound to 127.0.0.1. The tunnel (cloudflared) forwards
 * POST /sync and the module routes (e.g. /print/*) from
 * the edge-agent subdomain; /health is local-only. Everything but /health
 * requires the shared key.
 */
export function startServer(
  port: number,
  modules: EdgeModule[],
  startedAt: number,
  agentKey: string,
) {
  const app = new Hono()
    .get("/health", (c) =>
      c.json({
        version: AGENT_VERSION,
        startedAt,
        uptimeSeconds: Math.floor(Date.now() / 1000) - startedAt,
        modules: Object.fromEntries(modules.map((m) => [m.name, m.status()])),
      }),
    )
    // The worker's "something changed" poke. It carries no data: modules fetch
    // the desired state from the worker themselves, with their own key.
    .post("/sync", (c) => {
      if (!bearerMatches(c.req.header("Authorization"), agentKey)) {
        return c.json({ error: "Unauthorized." }, 401);
      }
      for (const m of modules) {
        m.sync?.().catch((err) => console.error(`[${m.name}] sync failed:`, err));
      }
      return c.json({ ok: true }, 202);
    });
  for (const m of modules) {
    if (!m.routes) continue;
    app.use(`/${m.name}/*`, async (c, next) => {
      if (!bearerMatches(c.req.header("Authorization"), agentKey)) {
        return c.json({ error: "Unauthorized." }, 401);
      }
      await next();
    });
    app.route(`/${m.name}`, m.routes);
  }
  return Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch });
}
