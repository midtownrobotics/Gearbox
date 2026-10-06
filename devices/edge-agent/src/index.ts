import { loadConfig } from "./core/config";
import { getMeta, openDb } from "./core/db";
import type { EdgeModule, ModuleContext } from "./core/module";
import { startServer } from "./core/server";
import { AGENT_VERSION } from "./core/version";
import { type SyncState, createWorkerClient } from "./core/worker-client";
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

for (const m of modules) await m.start();
const server = startServer(config.httpPort, modules, startedAt, config.agentKey);
console.log(
  `[agent] g3-edge-agent ${AGENT_VERSION} listening on 127.0.0.1:${server.port}${config.mock ? " (mock mode)" : ""}`,
);

async function shutdown(signal: string) {
  console.log(`[agent] ${signal}, shutting down`);
  server.stop();
  for (const m of modules) await m.stop();
  ctx.db.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
