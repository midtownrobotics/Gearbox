import {
  DEMO_PEOPLE,
  DEMO_SESSION_SECONDS,
  type DemoRole,
  demoTeamId,
  isDemoTeam,
  visitorFor,
} from "@g3/demo";
import { site, teamUiDefaults } from "@g3/site-config";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createDb } from "../db";
import { coreUsers, teamSignInMethods, teamUiSettings, teams } from "../db/schema";
import { sessionCookieOptions } from "../lib/cookie";
import { createSession } from "../lib/session";
import { requestTeamId, teamUrl } from "../lib/team";
import type { AppEnv } from "../types";
import { deleteTeam } from "./internal";

// The public demo (roadmap 5.1, 5.2): its team's accounts, and sign-in with no account. A visitor
// picks a role and gets a few hours as that role's shared account (@g3/demo's DEMO_PEOPLE).

const ROLES: readonly DemoRole[] = ["student", "mentor", "admin"];

/**
 * Makes the demo team in G3ID as it starts each day: its members (the same ids every time, so
 * each app's sample data can name them), its appearance and no other way to sign in. Everything
 * the team had is deleted first, sessions included.
 */
async function resetDemoTeam(env: AppEnv["Bindings"]) {
  await deleteTeam(env, demoTeamId);
  const db = createDb(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const appearance = { ...teamUiDefaults(demoTeamId, site.demo.name), shortName: "DEMO" };
  await db.batch([
    db.insert(teams).values({
      id: demoTeamId,
      teamNumber: site.demo.teamNumber,
      name: site.demo.name,
      createdAt: now,
      updatedAt: now,
    }),
    // One statement each: D1 takes at most 100 values in one.
    ...DEMO_PEOPLE.map((person) =>
      db.insert(coreUsers).values({
        id: person.id,
        teamId: demoTeamId,
        email: person.email,
        displayName: person.name,
        username: person.name,
        status: "active",
        isAdmin: person.isAdmin ? 1 : 0,
        isMentor: person.isMentor ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      }),
    ),
    db.insert(teamUiSettings).values({
      teamId: demoTeamId,
      settingsJson: JSON.stringify(appearance),
      updatedAt: now,
    }),
    db.insert(teamSignInMethods).values({
      teamId: demoTeamId,
      google: 0,
      github: 0,
      steam: 0,
      kioskPin: 0,
      updatedAt: now,
    }),
  ]);
}

/** For the platform's nightly reset (over its service binding; the gateway never answers it). */
export const demoInternalRouter = new Hono<AppEnv>().post("/teams/:id/demo/reset", async (c) => {
  if (!isDemoTeam(c.req.param("id"))) return c.json({ error: "Only the demo team." }, 403);
  await resetDemoTeam(c.env);
  return c.json({ ok: true, people: DEMO_PEOPLE.length });
});

/** Sign-in for the demo's visitors, on the demo team's G3ID only. */
export const demoAuthRouter = new Hono<AppEnv>()
  .get("/demo", (c) => {
    const team = requestTeamId(c);
    if (!isDemoTeam(team)) return c.json({ error: "This team isn't the demo." }, 404);
    return c.json({
      roles: ROLES.map((role) => ({ role, name: visitorFor(role).name })),
      home: `${teamUrl(c.env, team, "portal")}/`,
    });
  })
  .post("/demo", async (c) => {
    const team = requestTeamId(c);
    if (!isDemoTeam(team)) return c.json({ error: "This team isn't the demo." }, 404);
    const body = (await c.req.json().catch(() => null)) as { role?: unknown } | null;
    const role = ROLES.find((r) => r === body?.role);
    if (!role) return c.json({ error: "Pick student, mentor or admin." }, 400);

    const sessionId = await createSession(visitorFor(role).id, c.env, DEMO_SESSION_SECONDS);
    setCookie(c, "g3_session", sessionId, {
      ...sessionCookieOptions(c.req.url),
      maxAge: DEMO_SESSION_SECONDS,
    });
    return c.json({ ok: true, role, home: `${teamUrl(c.env, team, "portal")}/` });
  });
