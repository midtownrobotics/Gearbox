import { requireAdmin, requireAuth } from "@g3/auth";
import type { AppName } from "@g3/site-config";
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { Hono } from "hono";
import { type TEAM_ACTIONS, teamApps, teamAuditLog, teams } from "./db/schema";
import { accounts, db, now } from "./lib";
import { ALWAYS_ON, MANIFESTS, callHook, inLibrary, isAppName } from "./registry";
import type { AppEnv } from "./types";

// A team's apps (roadmap 4.2 to 4.4), for the team's own pages: the gateway sends
// <number>.<platform>/api/~platform/team/... here with the team (X-Team-Id). Members read which
// apps are on (the team's home lists them); the team's admins switch them on and off on the home's
// /admin pages and read the team's log.
//
// Switching an app on runs its seed hook (starter content; safe to run again). Switching it off
// hides it at once (the gateway checks with GET /teams/:id, remembered for a minute) and keeps its
// data for GRACE_S, so switching it on again brings everything back. After that the daily cron
// (clearSwitchedOff) has the app delete the team's data.

/** How long a switched-off app's data is kept (the privacy policy's 90 days). */
export const GRACE_S = 90 * 24 * 60 * 60;

type Db = ReturnType<typeof db>;

/** The apps a team has on: the always-on ones, then those it switched on. */
export async function enabledApps(database: Db, teamId: string): Promise<AppName[]> {
  const rows = await database
    .select({ app: teamApps.app })
    .from(teamApps)
    .where(and(eq(teamApps.teamId, teamId), eq(teamApps.enabled, true)))
    .all();
  const on = rows
    .map((r) => r.app)
    .filter(isAppName)
    .filter((app) => inLibrary(MANIFESTS[app], teamId));
  return [...ALWAYS_ON, ...on];
}

async function logTeam(
  database: Db,
  entry: {
    teamId: string;
    userId: string | null;
    action: (typeof TEAM_ACTIONS)[number];
    app: AppName;
    details?: Record<string, unknown>;
  },
) {
  await database.insert(teamAuditLog).values({
    id: crypto.randomUUID(),
    teamId: entry.teamId,
    userId: entry.userId,
    action: entry.action,
    app: entry.app,
    details: JSON.stringify(entry.details ?? {}),
    createdAt: now(),
  });
}

/** The library as the team's admins see it: every app the team may have, and its state. */
async function library(env: AppEnv["Bindings"], teamId: string) {
  const database = db(env);
  const rows = await database.select().from(teamApps).where(eq(teamApps.teamId, teamId)).all();
  const byApp = new Map(rows.map((r) => [r.app, r]));
  const names = await accounts(
    env,
    rows.map((r) => r.changedBy),
  ).catch(() => new Map<string, { displayName: string }>());
  return Object.values(MANIFESTS)
    .filter((app) => inLibrary(app, teamId))
    .map((app) => {
      const row = byApp.get(app.slug);
      return {
        slug: app.slug,
        name: app.name,
        summary: app.summary,
        integrations: app.integrations,
        version: app.version,
        enabled: row?.enabled ?? false,
        changedAt: row?.changedAt ?? null,
        changedBy: row?.changedBy ? (names.get(row.changedBy)?.displayName ?? null) : null,
        /** Switched off: when its data is deleted (null if the app keeps it). */
        deleteAfter: row && !row.enabled ? row.deleteAfter : null,
        /** Switched off and its data already deleted. */
        dataDeleted: row ? !row.enabled && row.dataDeletedAt !== null : false,
        keepsDataWhenOff: !app.hooks.delete,
      };
    });
}

export const teamRouter = new Hono<AppEnv>()
  // The team's apps that are on, for its home page.
  .get("/apps", requireAuth, async (c) => {
    const on = await enabledApps(db(c.env), c.get("teamId"));
    return c.json({
      apps: on.map((slug) => ({
        slug,
        name: MANIFESTS[slug].name,
        summary: MANIFESTS[slug].summary,
      })),
      isAdmin: c.get("userIsAdmin"),
    });
  })
  .use("/library", requireAdmin)
  .use("/library/*", requireAdmin)
  .use("/log", requireAdmin)
  .get("/library", async (c) => c.json(await library(c.env, c.get("teamId"))))
  .put("/library/:slug", async (c) => {
    const teamId = c.get("teamId");
    const slug = c.req.param("slug");
    const { enabled } = await c.req.json<{ enabled?: unknown }>();
    if (typeof enabled !== "boolean") return c.json({ error: "Say on or off." }, 400);
    if (!isAppName(slug) || !inLibrary(MANIFESTS[slug], teamId)) {
      return c.json({ error: "No such app." }, 404);
    }
    const app = MANIFESTS[slug];
    const database = db(c.env);
    // The team is in the registry (the gateway only answers active teams), but a test or a
    // direct call might not be.
    const team = await database.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));
    if (team.length === 0) return c.json({ error: "No such team." }, 404);

    const before = await database
      .select()
      .from(teamApps)
      .where(and(eq(teamApps.teamId, teamId), eq(teamApps.app, slug)))
      .get();
    if (before && !before.enabled && before.dataDeletedAt !== null && before.deleteAfter !== null) {
      // The daily cron is deleting its data right now (clearSwitchedOff).
      return c.json({ error: `${app.name}'s data is being deleted. Try again in a minute.` }, 409);
    }
    if ((before?.enabled ?? false) === enabled) {
      return c.json({ apps: await library(c.env, teamId), seeded: true });
    }

    const values = enabled
      ? { enabled, deleteAfter: null, dataDeletedAt: null }
      : {
          enabled,
          // An app without a delete hook keeps the team's data.
          deleteAfter: app.hooks.delete ? now() + GRACE_S : null,
          dataDeletedAt: null,
        };
    await database
      .insert(teamApps)
      .values({ teamId, app: slug, changedAt: now(), changedBy: c.get("userId"), ...values })
      .onConflictDoUpdate({
        target: [teamApps.teamId, teamApps.app],
        set: { changedAt: now(), changedBy: c.get("userId"), ...values },
      });
    // Switched on again within the grace period: nothing was deleted, so it's all still there.
    const restored = enabled && before !== undefined && before.dataDeletedAt === null;
    const seeded = enabled ? await callHook(c.env, slug, "seed", teamId) : true;
    await logTeam(database, {
      teamId,
      userId: c.get("userId"),
      action: enabled ? "app_enabled" : "app_disabled",
      app: slug,
      details: enabled ? { restored, seeded } : { deleteAfter: values.deleteAfter },
    });
    return c.json({ apps: await library(c.env, teamId), seeded });
  })
  // The team's log, newest first.
  .get("/log", async (c) => {
    const rows = await db(c.env)
      .select()
      .from(teamAuditLog)
      .where(eq(teamAuditLog.teamId, c.get("teamId")))
      .orderBy(desc(teamAuditLog.createdAt))
      .limit(200)
      .all();
    const names = await accounts(
      c.env,
      rows.map((r) => r.userId),
    ).catch(() => new Map<string, { displayName: string }>());
    return c.json(
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        app: r.app,
        appName: r.app && isAppName(r.app) ? MANIFESTS[r.app].name : r.app,
        userName: r.userId ? (names.get(r.userId)?.displayName ?? null) : null,
        details: JSON.parse(r.details) as Record<string, unknown>,
        createdAt: r.createdAt,
      })),
    );
  });

/**
 * The daily cron: each app switched off for longer than its grace period has the team's data
 * deleted by the app (its delete hook). Marked first, so a run that overlaps another doesn't ask
 * twice; an app that fails is unmarked and tried again the next day.
 */
export async function clearSwitchedOff(env: AppEnv["Bindings"]) {
  const database = db(env);
  const due = await database
    .update(teamApps)
    .set({ dataDeletedAt: now() })
    .where(
      and(
        eq(teamApps.enabled, false),
        lte(teamApps.deleteAfter, now()),
        isNull(teamApps.dataDeletedAt),
      ),
    )
    .returning();
  for (const row of due) {
    if (!isAppName(row.app)) continue;
    const ok = await callHook(env, row.app, "delete", row.teamId);
    if (!ok) {
      await database
        .update(teamApps)
        .set({ dataDeletedAt: null })
        .where(and(eq(teamApps.teamId, row.teamId), eq(teamApps.app, row.app)));
      continue;
    }
    await database
      .update(teamApps)
      .set({ deleteAfter: null })
      .where(
        and(
          eq(teamApps.teamId, row.teamId),
          eq(teamApps.app, row.app),
          eq(teamApps.enabled, false),
        ),
      );
    await logTeam(database, {
      teamId: row.teamId,
      userId: null,
      action: "app_data_deleted",
      app: row.app,
    });
  }
}
