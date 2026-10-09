import { platformUrl, platformUrlVia, teamAppUrlVia } from "@g3/site-config";
import { withApiPrefix } from "@g3/site-config/worker";
import { SLACK_BOT_SCOPES } from "@g3/slack";
import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import packageJson from "../package.json";
import { consoleRouter } from "./console";
import { numberReports, teams } from "./db/schema";
import { db, g3id, now } from "./lib";
import { clearSwitchedOff, enabledApps, logTeam, teamRouter } from "./team";
import type { AppEnv } from "./types";

// The platform: team sign-up (roadmap 2.7), the team registry the gateway asks about, the
// operators' console at /console (roadmap 2.8, src/console.ts), and each team's apps at /team
// (roadmap Phase 4, src/team.ts; the app library is src/registry.ts).
//
// Signing a team up, all on the platform's site:
//   1. POST /signup: the team's number, name, country, and the terms. A pending team.
//   2. GET /signup/:id/slack: "Add to Slack" installs the bot into the team's workspace; Slack
//      sends the founder back to /signup/slack/callback. G3ID gets the team and its workspace.
//   3. POST /signup/:id/code: a code (from G3ID) the founder sends to the bot from that workspace.
//      The team has no members yet, so G3ID makes them its first admin. GET /signup/:id/status
//      sees it, makes the team active, and hands back G3ID's link that signs them in on their
//      team's own address.
// Everyone after that joins through the team's Slack, like G3's members do. No second sign-up on
// other providers: accounts are G3ID's.

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong on our end. Please try again." }, 500);
});

/** A pending sign-up older than this gives its team number back. */
const SIGNUP_EXPIRES_S = 60 * 60;

const SLACK_REDIRECT_URI = `${platformUrl}/api/signup/slack/callback`;

/** The platform's own address: through the dev gateway in local dev. */
const site = (env: AppEnv["Bindings"]) => platformUrlVia(env.LOCAL_GATEWAY_URL || undefined);

/** Open reports kept per team number; more than this and new ones are turned away. */
const MAX_OPEN_REPORTS = 20;

async function signupFor(env: AppEnv["Bindings"], signupId: string) {
  return db(env).select().from(teams).where(eq(teams.signupId, signupId)).get();
}

/** Where a sign-up is: Slack to connect, the founder's code to send, or done. */
function step(team: typeof teams.$inferSelect): "slack" | "code" | "done" {
  if (team.status === "active") return "done";
  return team.slackWorkspaceId ? "code" : "slack";
}

const routes = app
  .get("/health", (c) =>
    c.json({ status: "ok", service: "platform", version: packageJson.version }),
  )
  // Whether a team exists (signed up and active), and the apps it has on: the gateway asks before
  // answering its addresses.
  .get("/teams/:id", async (c) => {
    const team = await db(c.env)
      .select({ id: teams.id, teamNumber: teams.teamNumber, name: teams.name })
      .from(teams)
      .where(and(eq(teams.id, c.req.param("id")), eq(teams.status, "active")))
      .get();
    if (!team) return c.json({ error: "No such team." }, 404);
    return c.json({ ...team, apps: await enabledApps(db(c.env), team.id) });
  })
  .post("/signup", async (c) => {
    const body = await c.req.json<{
      teamNumber?: unknown;
      name?: unknown;
      country?: unknown;
      acceptTerms?: unknown;
    }>();
    const teamNumber = Number(body.teamNumber);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const country = typeof body.country === "string" ? body.country.trim().toUpperCase() : "";

    if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 99999) {
      return c.json({ error: "Enter your FRC team number." }, 400);
    }
    if (!name || name.length > 80) return c.json({ error: "Enter your team's name." }, 400);
    if (!/^[A-Z]{2}$/.test(country)) return c.json({ error: "Choose your country." }, 400);
    if (body.acceptTerms !== true) {
      return c.json({ error: "Accept the terms of service and privacy policy to continue." }, 400);
    }

    const id = `frc${teamNumber}`;
    const existing = await db(c.env).select().from(teams).where(eq(teams.id, id)).get();
    if (existing?.status === "active" || existing?.status === "suspended") {
      return c.json({ error: `Team ${teamNumber} is already on Gearbox.` }, 409);
    }
    if (existing && existing.updatedAt > now() - SIGNUP_EXPIRES_S && existing.slackWorkspaceId) {
      // Someone got as far as connecting Slack within the hour: let them finish.
      return c.json({ error: `Team ${teamNumber} is being signed up right now.` }, 409);
    }

    const signupId = crypto.randomUUID();
    const values = {
      teamNumber,
      name,
      country,
      status: "pending" as const,
      slackWorkspaceId: null,
      slackWorkspaceName: null,
      termsAcceptedAt: now(),
      signupId,
      signupCodeToken: null,
      updatedAt: now(),
    };
    await db(c.env)
      .insert(teams)
      .values({ id, createdAt: now(), ...values })
      .onConflictDoUpdate({ target: teams.id, set: values });
    return c.json({ signupId }, 201);
  })
  .get("/signup/:signupId", async (c) => {
    const team = await signupFor(c.env, c.req.param("signupId"));
    if (!team) return c.json({ error: "This sign-up has expired. Please start again." }, 404);
    return c.json({
      teamNumber: team.teamNumber,
      name: team.name,
      step: step(team),
      workspaceName: team.slackWorkspaceName,
    });
  })
  // Step 2: install the Slack app into the team's workspace.
  .get("/signup/:signupId/slack", async (c) => {
    const team = await signupFor(c.env, c.req.param("signupId"));
    if (!team || team.status !== "pending") return c.redirect(`${site(c.env)}/signup`);
    const params = new URLSearchParams({
      client_id: c.env.SLACK_CLIENT_ID,
      scope: SLACK_BOT_SCOPES,
      redirect_uri: SLACK_REDIRECT_URI,
      state: team.signupId as string,
    });
    return c.redirect(`https://slack.com/oauth/v2/authorize?${params}`);
  })
  .get("/signup/slack/callback", async (c) => {
    const signupId = c.req.query("state") ?? "";
    const back = (error?: string) =>
      c.redirect(
        `${site(c.env)}/signup?id=${encodeURIComponent(signupId)}${error ? `&error=${encodeURIComponent(error)}` : ""}`,
      );
    const team = await signupFor(c.env, signupId);
    if (!team || team.status !== "pending") return back();
    const code = c.req.query("code");
    if (!code) return back("Slack wasn't connected. Try again to continue.");

    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.env.SLACK_CLIENT_ID,
        client_secret: c.env.SLACK_CLIENT_SECRET ?? "",
        code,
        redirect_uri: SLACK_REDIRECT_URI,
      }),
    });
    const slack = (await res.json()) as {
      ok: boolean;
      access_token?: string;
      bot_user_id?: string;
      team?: { id: string; name?: string };
    };
    if (!slack.ok || !slack.access_token || !slack.team) {
      return back("Slack didn't finish connecting. Please try again.");
    }

    // G3ID gets the team (its tables point at it) and the workspace's bot token.
    await g3id(c.env, "/teams", {
      method: "PUT",
      body: { id: team.id, teamNumber: team.teamNumber, name: team.name },
    });
    const saved = await g3id(c.env, "/slack-installations", {
      method: "POST",
      body: {
        teamId: team.id,
        workspaceId: slack.team.id,
        workspaceName: slack.team.name ?? null,
        botUserId: slack.bot_user_id ?? null,
        botToken: slack.access_token,
      },
    });
    if (saved.status === 409) {
      return back("That Slack workspace is already connected to another team.");
    }
    if (!saved.ok) return back("Slack didn't finish connecting. Please try again.");

    await db(c.env)
      .update(teams)
      .set({
        slackWorkspaceId: slack.team.id,
        slackWorkspaceName: slack.team.name ?? null,
        updatedAt: now(),
      })
      .where(eq(teams.id, team.id));
    return back();
  })
  // Someone says a team number was signed up by people who aren't that team. Kept for an operator,
  // who gets in touch by email; a false registration can mean deleting the team and its data.
  .post("/reports", async (c) => {
    const body = await c.req.json<{
      teamNumber?: unknown;
      email?: unknown;
      name?: unknown;
      message?: unknown;
    }>();
    const teamNumber = Number(body.teamNumber);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 99999) {
      return c.json({ error: "Enter the team number." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return c.json({ error: "Enter an email address we can reach you at." }, 400);
    }
    if (!message || message.length > 2000) {
      return c.json(
        { error: "Tell us how you're connected to the team (up to 2000 characters)." },
        400,
      );
    }

    const [{ open }] = await db(c.env)
      .select({ open: count() })
      .from(numberReports)
      .where(and(eq(numberReports.teamNumber, teamNumber), eq(numberReports.status, "open")));
    if (open >= MAX_OPEN_REPORTS) {
      return c.json(
        { error: "We already have reports about this team number and are looking into it." },
        429,
      );
    }

    await db(c.env)
      .insert(numberReports)
      .values({
        id: crypto.randomUUID(),
        teamNumber,
        email,
        name: name || null,
        message,
        createdAt: now(),
      });
    return c.json({ ok: true }, 201);
  })
  // Step 3: the code the founder sends to the bot.
  .post("/signup/:signupId/code", async (c) => {
    const team = await signupFor(c.env, c.req.param("signupId"));
    if (!team || step(team) !== "code") return c.json({ error: "Connect Slack first." }, 409);
    const res = await g3id(c.env, "/signup-codes", {
      method: "POST",
      body: {
        teamId: team.id,
        redirect: `${teamAppUrlVia(c.env.LOCAL_GATEWAY_URL, team.id, "portal")}/`,
      },
    });
    const { code, token } = (await res.json()) as { code: string; token: string };
    await db(c.env)
      .update(teams)
      .set({ signupCodeToken: token, updatedAt: now() })
      .where(eq(teams.id, team.id));
    return c.json({ code });
  })
  .get("/signup/:signupId/status", async (c) => {
    const team = await signupFor(c.env, c.req.param("signupId"));
    if (!team?.signupCodeToken) return c.json({ status: "expired" as const });
    const token = team.signupCodeToken;
    const res = await g3id(c.env, `/signup-codes/${token}`);
    const code = (await res.json()) as { status: string; message?: string; userId?: string };

    if (code.status === "success" && code.userId) {
      // The founder's account exists and is signed in: the team is live.
      await db(c.env)
        .update(teams)
        .set({
          status: "active",
          founderUserId: code.userId,
          ownerUserId: code.userId,
          updatedAt: now(),
        })
        .where(and(eq(teams.id, team.id), eq(teams.status, "pending")));
      const home = `${teamAppUrlVia(c.env.LOCAL_GATEWAY_URL, team.id, "portal")}/`;
      return c.json({
        status: "done" as const,
        // G3ID sets the session cookie on the team's own domain, then opens the team's home.
        signInUrl: `${teamAppUrlVia(c.env.LOCAL_GATEWAY_URL, team.id, "id")}/api/auth/slack/complete?token=${token}&redirect=${encodeURIComponent(home)}`,
      });
    }
    if (code.status === "failed") {
      return c.json({ status: "failed" as const, message: code.message ?? "That didn't work." });
    }
    if (code.status === "pending") return c.json({ status: "pending" as const });
    return c.json({ status: "expired" as const });
  })
  // A big settings change in one of the team's apps, for the team's log (its admins read it on
  // the home's Apps page). Apps send it through G3ID (`logTeamChange` in @g3/auth); only other
  // workers reach /internal: the gateway never answers it. Field names only, never values.
  .post("/internal/teams/:id/audit", async (c) => {
    const teamId = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as {
      userId?: unknown;
      app?: unknown;
      what?: unknown;
      changed?: unknown;
    } | null;
    const text = (v: unknown, max: number) =>
      typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
    const app = text(body?.app, 40);
    const what = text(body?.what, 100);
    if (!app || !what) return c.json({ error: "Say which app and what changed." }, 400);
    const userId = body?.userId === null ? null : text(body?.userId, 100);
    const changed = Array.isArray(body?.changed)
      ? body.changed
          .filter((f): f is string => typeof f === "string" && f.length <= 60)
          .slice(0, 30)
      : [];
    const database = db(c.env);
    const team = await database
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, teamId))
      .get();
    if (!team) return c.json({ error: "No such team." }, 404);
    await logTeam(database, {
      teamId,
      userId,
      action: "settings_changed",
      app,
      details: { what, changed },
    });
    return c.json({ ok: true });
  })
  .route("/console", consoleRouter)
  .route("/team", teamRouter);

export type PlatformApp = typeof routes;
export default {
  fetch: withApiPrefix(app.fetch),
  // Daily: apps switched off for longer than the grace period have the team's data deleted.
  async scheduled(_controller: ScheduledController, env: AppEnv["Bindings"]) {
    await clearSwitchedOff(env);
  },
} satisfies ExportedHandler<AppEnv["Bindings"]>;
