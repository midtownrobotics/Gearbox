import { signInCallbackApiUrl } from "@g3/site-config";
import { SLACK_BOT_SCOPES, sendDM, verifySlackSignature } from "@g3/slack";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { coreSlackLinkCodes } from "../db/schema";
import { handleSlackCode } from "../lib/slack-code";
import {
  removeInstallation,
  saveInstallation,
  slackForTeam,
  teamForWorkspace,
} from "../lib/slack-install";
import { siteTeamId, teamOfUser, teamUrl } from "../lib/team";
import { logToTeam } from "../lib/team-log";
import { requireAdmin } from "../middleware/auth";
import type { AppEnv } from "../types";

// Slack per team: one Slack app, installed into each team's workspace by a team admin (/install,
// from the Slack page on the team's admin pages, calling back on the platform's id.<domain>).
// Slash commands and events arrive from any of those workspaces and find their team by workspace.

/** Where Slack sends an admin back after installing: the same for every team. */
const INSTALL_REDIRECT_URI = `${signInCallbackApiUrl(siteTeamId)}/slack/oauth/callback`;

/** A DM from the bot, in the workspace the request came from. */
async function reply(env: AppEnv["Bindings"], workspaceId: string, userId: string, text: string) {
  const team = await teamForWorkspace(env, workspaceId);
  const teamSlack = team ? await slackForTeam(env, team) : null;
  if (teamSlack) await sendDM(userId, text, teamSlack.slack);
}

export const slackRouter = new Hono<AppEnv>()
  // A team admin installs the Slack app into the team's workspace.
  .get("/install", requireAdmin, async (c) => {
    if (!c.env.SLACK_CLIENT_ID || !c.env.SECRETS_KEY) {
      return c.json({ error: "Connecting Slack isn't set up on this server." }, 503);
    }
    const userId = c.get("userId") as string;
    const team = await teamOfUser(createDb(c.env.DB), userId);
    const state = crypto.randomUUID();
    await c.env.RATE_LIMIT.put(`slack_install:${state}`, JSON.stringify({ team, userId }), {
      expirationTtl: 600,
    });
    const params = new URLSearchParams({
      client_id: c.env.SLACK_CLIENT_ID,
      scope: SLACK_BOT_SCOPES,
      redirect_uri: INSTALL_REDIRECT_URI,
      state,
    });
    return c.redirect(`https://slack.com/oauth/v2/authorize?${params}`);
  })
  // Slack sends the admin back here (on id.<domain>) with a code for the workspace's bot token.
  .get("/oauth/callback", async (c) => {
    const stateKey = `slack_install:${c.req.query("state") ?? ""}`;
    const saved = await c.env.RATE_LIMIT.get(stateKey);
    await c.env.RATE_LIMIT.delete(stateKey);
    const { team, userId } = saved
      ? (JSON.parse(saved) as { team: string; userId: string })
      : { team: null, userId: null };
    // Back to the Slack page on the team's admin pages (its home's /admin).
    const back = (query: string) =>
      c.redirect(
        `${team ? teamUrl(c.env, team, "portal") : c.env.FRONTEND_URL}/admin/slack?${query}`,
      );
    const fail = (message: string) => back(`error=${encodeURIComponent(message)}`);

    if (!team || !userId) return fail("This link has expired. Please try again.");
    const code = c.req.query("code");
    if (!code) return fail("Slack wasn't connected.");

    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.env.SLACK_CLIENT_ID ?? "",
        client_secret: c.env.SLACK_CLIENT_SECRET ?? "",
        code,
        redirect_uri: INSTALL_REDIRECT_URI,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      access_token?: string;
      bot_user_id?: string;
      team?: { id: string; name?: string };
    };
    if (!data.ok || !data.access_token || !data.team) {
      return fail("Slack didn't finish connecting. Please try again.");
    }

    const result = await saveInstallation(c.env, {
      teamId: team,
      workspaceId: data.team.id,
      workspaceName: data.team.name ?? null,
      botUserId: data.bot_user_id ?? null,
      botToken: data.access_token,
      installedBy: userId,
    });
    if (result === "taken")
      return fail("That Slack workspace is already connected to another team.");
    await logToTeam(c.env, team, {
      userId,
      app: "id",
      what: "Slack connected",
      changed: [data.team.name ?? data.team.id],
    });
    return back("connected=1");
  })
  // Events API — handles DMs and URL verification challenge
  // Events API — handles DMs and URL verification challenge
  .post("/events", async (c) => {
    const rawBody = await c.req.text();

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.text("", 200);
    }

    // Slack URL verification challenge — no signature check required
    if (body.type === "url_verification") {
      return c.json({ challenge: body.challenge });
    }

    if (!(await verifySlackSignature(c.req.raw, rawBody, c.env))) {
      return c.text("", 200);
    }

    if (body.type !== "event_callback") return c.text("", 200);

    // The app was removed from a workspace: forget that team's token.
    const removed = body.event as { type?: string; tokens?: { bot?: string[] } } | undefined;
    if (
      removed?.type === "app_uninstalled" ||
      (removed?.type === "tokens_revoked" && removed.tokens?.bot?.length)
    ) {
      await removeInstallation(c.env, { workspaceId: (body.team_id as string) ?? "" });
      return c.text("", 200);
    }

    const event = (body.event ?? {}) as {
      type?: string;
      subtype?: string;
      bot_id?: string;
      user?: string;
      text?: string;
    };

    // Ignore non-messages, bot messages, and anything without a 4-digit code
    if (event.type !== "message" || event.subtype || event.bot_id) return c.text("", 200);

    const slackUserId = event.user ?? "";
    const text = event.text?.trim() ?? "";
    const workspaceId = (body.team_id as string) ?? "";

    // Extract 4-digit code from anywhere in the text
    const codeMatch = text.match(/\d{4}/);
    const code = codeMatch?.[0] ?? "";

    if (!slackUserId || !code) return c.text("", 200);

    c.executionCtx.waitUntil(
      (async () => {
        // Look up the code to discover its type before calling handleSlackCode
        const db = createDb(c.env.DB);
        const record = await db
          .select({ type: coreSlackLinkCodes.type, teamId: coreSlackLinkCodes.teamId })
          .from(coreSlackLinkCodes)
          .where(and(eq(coreSlackLinkCodes.code, code), eq(coreSlackLinkCodes.used, 0)))
          .get();

        if (!record) {
          await reply(
            c.env,
            workspaceId,
            slackUserId,
            "❌ Invalid or expired code. Please try again.",
          );
          return;
        }

        const result = await handleSlackCode({
          code,
          slackUserId,
          workspaceId,
          type: record.type as "signin" | "link",
          env: c.env,
        });

        // For successful sign-ins, add a direct link to complete auth from browser
        let message = result.message;
        if (result.success && result.token && record.type === "signin") {
          // The code's team's own G3ID address, where its sign-in started.
          let completeUrl = `${teamUrl(c.env, record.teamId, "id")}/api/auth/slack/complete?token=${result.token}`;
          if (result.redirectUrl) {
            completeUrl += `&redirect=${encodeURIComponent(result.redirectUrl)}`;
          }
          message = `${message}\n\n<${completeUrl}|Click here to return to your browser>\n\nFor your next login, if you clicked the "↗ Open Slack" button, the code has already been copied to your device and you can simply paste it below!! ↓↓↓↓↓↓`;
        }

        await reply(c.env, workspaceId, slackUserId, message);
      })(),
    );

    return c.text("", 200);
  })
  // /signin slash command
  .post("/commands/signin", async (c) => {
    const rawBody = await c.req.text();
    if (!(await verifySlackSignature(c.req.raw, rawBody, c.env))) return c.text("", 200);

    const params = new URLSearchParams(rawBody);
    const text = params.get("text")?.trim() ?? "";
    const slackUserId = params.get("user_id") ?? "";
    const workspaceId = params.get("team_id") ?? "";

    // Extract 4-digit code from anywhere in the text
    const codeMatch = text.match(/\d{4}/);
    const code = codeMatch?.[0] ?? "";

    if (!code) {
      return c.json({ response_type: "ephemeral", text: "Usage: `/signin 1234`" });
    }

    c.executionCtx.waitUntil(
      handleSlackCode({ code, slackUserId, workspaceId, type: "signin", env: c.env }).then(
        (result) => reply(c.env, workspaceId, slackUserId, result.message),
      ),
    );

    return c.text("", 200);
  })
  // /link slash command
  .post("/commands/link", async (c) => {
    const rawBody = await c.req.text();
    if (!(await verifySlackSignature(c.req.raw, rawBody, c.env))) return c.text("", 200);

    const params = new URLSearchParams(rawBody);
    const text = params.get("text")?.trim() ?? "";
    const slackUserId = params.get("user_id") ?? "";
    const workspaceId = params.get("team_id") ?? "";

    // Extract 4-digit code from anywhere in the text
    const codeMatch = text.match(/\d{4}/);
    const code = codeMatch?.[0] ?? "";

    if (!code) {
      return c.json({ response_type: "ephemeral", text: "Usage: `/link 1234`" });
    }

    c.executionCtx.waitUntil(
      handleSlackCode({ code, slackUserId, workspaceId, type: "link", env: c.env }).then((result) =>
        reply(c.env, workspaceId, slackUserId, result.message),
      ),
    );

    return c.text("", 200);
  });
