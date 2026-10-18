import { inTeam } from "@g3/auth";
import { inArray } from "drizzle-orm";
import type { Context } from "hono";
import { teamApiKey } from "./api-keys";
import { dbOf } from "./db";
import { manualEvents, strategyEventConfig } from "./db/schema";
import type { AppEnv } from "./types";
import { text } from "./utils";

/** Manual names are private to the team; only public TBA names enter the HTTP cache. */
export async function analysisEventNames(c: Context<AppEnv>, eventKeys: string[]) {
  const keys = [...new Set(eventKeys.filter(Boolean))];
  if (!keys.length) return {};
  const db = dbOf(c);
  const manual = await db
    .select({ key: manualEvents.event_key, name: manualEvents.event_name })
    .from(manualEvents)
    .where(inTeam(manualEvents, c.get("teamId"), inArray(manualEvents.event_key, keys)))
    .all();
  const names = new Map(manual.map(({ key, name }) => [key, name]));
  const pending = keys.filter((key) => !names.has(key) && /^\d{4}[a-z0-9]+$/i.test(key));
  if (!pending.length) return Object.fromEntries(names);
  const config = await db
    .select({ authKey: strategyEventConfig.tba_auth_key })
    .from(strategyEventConfig)
    .where(inTeam(strategyEventConfig, c.get("teamId")))
    .get();
  const authKey = teamApiKey(c.get("teamId"), config?.authKey, c.env.TBA_AUTH_KEY);

  async function resolve(key: string) {
    try {
      // The full Event model includes short_name; Event_Simple does not.
      // https://www.thebluealliance.com/apidocs/v3
      const url = `https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(key)}`;
      const cache = await caches.open("scouting-event-names");
      const cached = await cache.match(url);
      if (cached) {
        names.set(key, await cached.text());
        return;
      }
      if (!authKey) return;
      const response = await fetch(url, {
        headers: { "X-TBA-Auth-Key": authKey },
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return;
      const event = await response.json<{ short_name?: string | null; name?: string }>();
      const name = text(event.short_name, 200) || text(event.name, 200);
      if (!name) return;
      names.set(key, name);
      await cache.put(
        url,
        new Response(name, { headers: { "Cache-Control": "public, max-age=86400" } }),
      );
    } catch {
      // A missing name or unavailable TBA must not hide scouting reports.
    }
  }

  // Bound outbound concurrency when reports span many competitions.
  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, async () => {
      for (let key = pending.pop(); key; key = pending.pop()) await resolve(key);
    }),
  );
  return Object.fromEntries(names);
}
