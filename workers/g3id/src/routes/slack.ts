import { teamAppUrl } from "@g3/site-config";
import { sendDM, verifySlackSignature } from "@g3/slack";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { coreSlackLinkCodes } from "../db/schema";
import { handleSlackCode } from "../lib/slack-code";
import type { AppEnv } from "../types";

export const slackRouter = new Hono<AppEnv>()
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
          await sendDM(slackUserId, "❌ Invalid or expired code. Please try again.", c.env);
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
          let completeUrl = `${teamAppUrl(record.teamId, "id")}/api/auth/slack/complete?token=${result.token}`;
          if (result.redirectUrl) {
            completeUrl += `&redirect=${encodeURIComponent(result.redirectUrl)}`;
          }
          message = `${message}\n\n<${completeUrl}|Click here to return to your browser>\n\nFor your next login, if you clicked the "↗ Open Slack" button, the code has already been copied to your device and you can simply paste it below!! ↓↓↓↓↓↓`;
        }

        await sendDM(slackUserId, message, c.env);
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
        (result) => sendDM(slackUserId, result.message, c.env),
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
        sendDM(slackUserId, result.message, c.env),
      ),
    );

    return c.text("", 200);
  });
