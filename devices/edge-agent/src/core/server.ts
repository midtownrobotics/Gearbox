import { Hono } from "hono";
import { bearerMatches } from "./key";
import type { EdgeModule } from "./module";
import { AGENT_VERSION } from "./version";

/**
 * The agent's API: /health, POST /sync (the worker's "something changed"
 * poke) and each module's routes at /<name>. Everything but /health requires
 * the shared key. The worker reaches it over the link (core/link.ts), which
 * calls it directly with the key; it's also served on 127.0.0.1 for checks on
 * the box.
 */
export function createAgentApp(
  modules: EdgeModule[],
  startedAt: number,
  agentKey: string,
  /** Extra /health fields from core (the link's state). */
  coreStatus: () => Record<string, unknown> = () => ({}),
) {
  const app = new Hono()
    .get("/health", (c) =>
      c.json({
        version: AGENT_VERSION,
        startedAt,
        uptimeSeconds: Math.floor(Date.now() / 1000) - startedAt,
        ...coreStatus(),
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
  return app;
}

export type AgentApp = ReturnType<typeof createAgentApp>;

/** Local-only: bound to 127.0.0.1, never reachable from the LAN or the internet. */
export function startServer(port: number, app: AgentApp) {
  return Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch });
}
