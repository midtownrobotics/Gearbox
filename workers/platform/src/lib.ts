import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { AppEnv } from "./types";

export const db = (env: AppEnv["Bindings"]) => drizzle(env.PLATFORM_DB, { schema });
export const now = () => Math.floor(Date.now() / 1000);

/** G3ID's internal routes, over the service binding. */
export function g3id(
  env: AppEnv["Bindings"],
  path: string,
  init?: { method: string; body?: unknown },
) {
  return env.G3ID.fetch(
    new Request(`http://g3id/api/internal${path}`, {
      method: init?.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}
