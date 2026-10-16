import { desc, gte, sql } from "drizzle-orm";
import { landingVisits } from "./db/schema";
import { db } from "./lib";
import type { AppEnv } from "./types";

// Visits to the public landing page, per day: the page sends one when it opens (once per browser
// tab session), and this counts it, noting whether the visitor is signed in to Gearbox on any
// team. Nothing about the visitor is stored. Operators see the counts in the console.

/** Whether the request carries a session G3ID knows (any team's). */
async function signedIn(env: AppEnv["Bindings"], cookie: string | undefined) {
  if (!cookie?.includes("g3_session=")) return false;
  const res = await env.G3ID.fetch(
    new Request("http://g3id/api/auth/me?includeIdentities=false", { headers: { cookie } }),
  ).catch(() => null);
  return res?.ok === true;
}

export async function countVisit(env: AppEnv["Bindings"], cookie: string | undefined) {
  const day = new Date().toISOString().slice(0, 10);
  const signed = (await signedIn(env, cookie)) ? 1 : 0;
  await db(env)
    .insert(landingVisits)
    .values({ day, visits: 1, signedIn: signed })
    .onConflictDoUpdate({
      target: landingVisits.day,
      set: {
        visits: sql`${landingVisits.visits} + 1`,
        signedIn: sql`${landingVisits.signedIn} + ${signed}`,
      },
    });
}

/** The last `days` days with visits, newest first. */
export function recentVisits(env: AppEnv["Bindings"], days: number) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  return db(env)
    .select()
    .from(landingVisits)
    .where(gte(landingVisits.day, since))
    .orderBy(desc(landingVisits.day));
}
