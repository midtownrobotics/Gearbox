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

type Account = { id: string; displayName: string; email: string; teamId: string };

/** G3ID accounts by id (any team). */
export async function accounts(env: AppEnv["Bindings"], ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map<string, Account>();
  const res = await g3id(env, `/users?ids=${wanted.map(encodeURIComponent).join(",")}`);
  if (!res.ok) throw new Error(`G3ID /users: ${res.status}`);
  const list = (await res.json()) as Account[];
  return new Map(list.map((a) => [a.id, a]));
}
