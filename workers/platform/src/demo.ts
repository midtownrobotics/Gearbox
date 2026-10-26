import { DEMO_PEOPLE, type DemoPerson, SAFE_TEXT, demoHour, demoTeamId } from "@g3/demo";
import { site } from "@g3/site-config";
import { eq } from "drizzle-orm";
import { notifications, teamApps, teams } from "./db/schema";
import { db, now } from "./lib";
import { DELETABLE, MANIFESTS, callHook, inLibrary } from "./registry";
import type { AppEnv } from "./types";

// The public demo's reset (roadmap 5.4): every night at midnight in the demo's time zone the demo
// team's data is deleted in every app and loaded again with sample data, so nothing a visitor did
// lasts. The platform's own sample is one notification from the team's admin on its home page. The hourly cron runs it at that hour, or at once when the demo team doesn't exist yet
// (a new deploy). It goes on past an app that fails, and that app's data waits for the next night.

type Env = AppEnv["Bindings"];

/** The demo team, active, with every app any team can switch on. */
async function ensureDemoTeam(env: Env) {
  const at = now();
  const database = db(env);
  await database
    .insert(teams)
    .values({
      id: demoTeamId,
      teamNumber: site.demo.teamNumber,
      name: site.demo.name,
      country: "US",
      status: "active",
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: teams.id,
      set: { name: site.demo.name, status: "active", updatedAt: at },
    });
  const apps = Object.values(MANIFESTS).filter((app) => inLibrary(app, demoTeamId));
  const switchOn = apps.map((app) =>
    database
      .insert(teamApps)
      .values({ teamId: demoTeamId, app: app.slug, enabled: true, changedAt: at })
      .onConflictDoUpdate({
        target: [teamApps.teamId, teamApps.app],
        set: { enabled: true, deleteAfter: null, changedAt: at },
      }),
  );
  const [first, ...rest] = switchOn;
  if (first) await database.batch([first, ...rest]);
  const res = await env.G3ID.fetch(
    new Request("http://g3id/api/internal/teams", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: demoTeamId,
        teamNumber: site.demo.teamNumber,
        name: site.demo.name,
      }),
    }),
  );
  if (!res.ok) throw new Error(`G3ID couldn't make the demo team: ${res.status}`);
}

/** The demo team's own notifications: only the one its admin "sent" this week. */
async function resetNotifications(env: Env) {
  const at = now();
  const admin = DEMO_PEOPLE.find((p) => p.visitor === "admin") as DemoPerson;
  const database = db(env);
  await database.batch([
    database.delete(notifications).where(eq(notifications.teamId, demoTeamId)),
    database.insert(notifications).values({
      id: crypto.randomUUID(),
      type: "info",
      teamId: demoTeamId,
      summary: SAFE_TEXT.announcement[0],
      body: SAFE_TEXT.announcement[4],
      expiresAt: at + 7 * 24 * 60 * 60,
      createdBy: admin.id,
      createdAt: at - 2 * 60 * 60,
    }),
  ]);
}

/** Wipes the demo team and loads its sample data again. Returns the apps that failed. */
export async function resetDemo(env: Env): Promise<string[]> {
  const failed: string[] = [];
  await ensureDemoTeam(env);
  for (const app of DELETABLE) {
    if (!(await callHook(env, app.slug, "delete", demoTeamId))) failed.push(`${app.slug} delete`);
  }
  const people = await env.G3ID.fetch(
    new Request(`http://g3id/api/internal/teams/${demoTeamId}/demo/reset`, { method: "POST" }),
  );
  if (!people.ok) failed.push("id reset");
  await resetNotifications(env);
  for (const app of Object.values(MANIFESTS)) {
    if (app.hooks.demo && !(await callHook(env, app.slug, "demo", demoTeamId))) {
      failed.push(`${app.slug} demo`);
    }
  }
  if (failed.length) console.error("[demo] reset left out", failed);
  return failed;
}

/** The hourly cron: resets the demo at midnight in its time zone, or now if it doesn't exist. */
export async function maybeResetDemo(env: Env, at: Date) {
  const exists = await db(env)
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.id, demoTeamId))
    .get();
  if (exists && demoHour(at) !== 0) return;
  await resetDemo(env);
}
