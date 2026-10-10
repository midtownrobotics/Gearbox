import { loadConfig } from "./core/config";
import { getMeta, openDb } from "./core/db";
import { WorkerLink } from "./core/link";
import type { EdgeModule, ModuleContext } from "./core/module";
import { createAgentApp, startServer } from "./core/server";
import { AGENT_VERSION } from "./core/version";
import { type SyncState, agentHeaders, createWorkerClient } from "./core/worker-client";
import { createDriveModule } from "./modules/drive";
import { createLookupModule } from "./modules/lookup";
import { createNetworkModule } from "./modules/network";
import { createPrintModule } from "./modules/print";
import { createSwitchModule } from "./modules/switch";

const config = loadConfig();
const startedAt = Math.floor(Date.now() / 1000);
const db = openDb(config.dbPath);
const sync: SyncState = { applied: Number(getMeta(db, "applied_state_version") ?? 0) };
const ctx: ModuleContext = {
  config,
  db,
  sync,
  worker: createWorkerClient(config, startedAt, sync),
};

const modules: EdgeModule[] = [
  createSwitchModule(ctx),
  createNetworkModule(ctx),
  createPrintModule(ctx),
  createDriveModule(ctx),
  createLookupModule(ctx),
];

let link: WorkerLink | null = null;
const app = createAgentApp(modules, startedAt, config.agentKey, () => ({
  link: link?.status() ?? null,
}));
link = new WorkerLink(
  config.workerUrl,
  () => agentHeaders(config, startedAt, sync),
  app.fetch,
  config.agentKey,
);

for (const m of modules) await m.start();
const server = startServer(config.httpPort, app);
// How the worker reaches the box (print, lookup, sync pokes, ...).
link.start();
console.log(
  `[agent] g3-edge-agent ${AGENT_VERSION} listening on 127.0.0.1:${server.port}${config.mock ? " (mock mode)" : ""}`,
);

async function shutdown(signal: string) {
  console.log(`[agent] ${signal}, shutting down`);
  link?.stop();
  server.stop();
  for (const m of modules) await m.stop();
  ctx.db.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
