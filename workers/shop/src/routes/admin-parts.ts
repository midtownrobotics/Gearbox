import { inTeam, requireAdmin, requireAuth, sendTeamMessage } from "@g3/auth";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { createShopDb } from "../db";
import * as schema from "../db/schema";
import {
  formatOverview,
  formatReflection,
  getOverviewStats,
  getReflectionStats,
} from "../lib/daily-summary";
import { onshapeConfig, saveOnshapeConfig } from "../lib/onshape-config";
import { exportDrawingAsPDF, storeDrawingInR2 } from "../lib/onshape-export";
import { registerOnShapeWebhook, unregisterOnShapeWebhooks } from "../lib/onshape-webhook";
import { SETTING, getSetting, setSetting } from "../lib/settings";
import { shopUrl } from "../lib/urls";
import type { AppEnv } from "../types";

const RELEASE_CHANNEL_KEY = SETTING.slackReleaseChannel;
const SUMMARY_CHANNEL_KEY = SETTING.slackSummaryChannel;

/** Where the team's Onshape webhook calls back: its own Shop address. */
const eventsUrl = (env: AppEnv["Bindings"], teamId: string) =>
  `${shopUrl(env, teamId)}/api/onshape/events`;

export const adminPartsRouter = new Hono<AppEnv>()
  .get("/parts/pending", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");

    // Get all parts from onshapeParts and partDefinitions
    const onshapeParts = await db
      .select()
      .from(schema.onshapeParts)
      .where(inTeam(schema.onshapeParts, teamId))
      .all();
    const definitions = await db
      .select()
      .from(schema.partDefinitions)
      .where(inTeam(schema.partDefinitions, teamId))
      .all();

    // Normalize timestamps to seconds for consistent comparison
    const toSeconds = (ts: number) => (ts > 10000000000 ? Math.floor(ts / 1000) : ts);

    // Create a map of part number to their definition's createdAt (in seconds)
    const definitionsByNumber = new Map<string, number>();
    for (const def of definitions) {
      const defSeconds = toSeconds(def.createdAt);
      const existing = definitionsByNumber.get(def.onshapePartNumber);
      // Keep the most recent definition's createdAt for each part number
      if (!existing || defSeconds > existing) {
        definitionsByNumber.set(def.onshapePartNumber, defSeconds);
      }
    }

    // Filter to parts that are either:
    // 1. Don't have a definition yet, OR
    // 2. Are newer than their definition (createdAt > definition's createdAt)
    const unfilteredPending = onshapeParts.filter((p) => {
      const partSeconds = toSeconds(p.createdAt);
      const defSeconds = definitionsByNumber.get(p.partNumber);
      // Keep if no definition exists, or if this part is newer than the definition
      return !defSeconds || partSeconds > defSeconds;
    });

    // Keep only the most recent version of each part (by createdAt)
    const partsByNumber = new Map<string, (typeof unfilteredPending)[0]>();
    for (const part of unfilteredPending) {
      const existing = partsByNumber.get(part.partNumber);
      if (!existing || part.createdAt > existing.createdAt) {
        partsByNumber.set(part.partNumber, part);
      }
    }
    const pendingParts = Array.from(partsByNumber.values());

    const subsystems = await db
      .select()
      .from(schema.subsystems)
      .where(inTeam(schema.subsystems, teamId))
      .all();

    return c.json({
      parts: pendingParts,
      subsystems,
    });
  })
  .post("/parts/:partNumber/:revision/fetch-drawing", requireAuth, async (c) => {
    const partNumber = c.req.param("partNumber");
    const revision = c.req.param("revision");

    if (!partNumber || !revision) {
      return c.json({ error: "Missing partNumber or revision" }, 400);
    }

    try {
      const db = createShopDb(c.env.SHOP_DB);
      const teamId = c.get("teamId");

      // Get the OnShape part info
      const part = await db
        .select()
        .from(schema.onshapeParts)
        .where(inTeam(schema.onshapeParts, teamId, eq(schema.onshapeParts.partNumber, partNumber)))
        .get();

      if (!part) {
        return c.json(
          {
            error: "Part not found in OnShape data",
            detail: `No part found with number "${partNumber}"`,
          },
          404,
        );
      }

      if (!part.partDrawingEntityId) {
        return c.json(
          {
            error: "Part has no drawing available",
            detail: "This part exists but has no drawing in OnShape",
          },
          400,
        );
      }

      if (!part.versionId) {
        return c.json(
          {
            error: "Part version not available",
            detail: "Drawing metadata is missing the version ID",
          },
          400,
        );
      }

      const { documentId, credentials } = await onshapeConfig(c.env, db, teamId);

      if (!documentId) {
        return c.json({ error: "Document ID not configured" }, 400);
      }
      if (!credentials) {
        return c.json({ error: "Onshape API keys not configured" }, 400);
      }

      // Fetch the drawing
      const pdfBuffer = await exportDrawingAsPDF(
        documentId,
        part.versionId,
        part.partDrawingEntityId,
        credentials,
      );

      // Store in R2 with revision in path (stamps the part-number barcode on the way in)
      await storeDrawingInR2(c.env, teamId, partNumber, revision, pdfBuffer);

      return c.json({
        success: true,
        partNumber,
        revision,
        message: "Drawing fetched and cached successfully",
      });
    } catch (err) {
      console.error("[Admin Parts] Drawing fetch error", err);
      return c.json(
        {
          error: err instanceof Error ? err.message : "Failed to fetch drawing",
        },
        500,
      );
    }
  })
  .delete("/parts/:partNumber", requireAuth, async (c) => {
    const partNumber = c.req.param("partNumber");

    if (!partNumber) {
      return c.json({ error: "Missing partNumber" }, 400);
    }

    try {
      const db = createShopDb(c.env.SHOP_DB);

      // Delete all onshapeParts with this part number
      await db
        .delete(schema.onshapeParts)
        .where(
          inTeam(
            schema.onshapeParts,
            c.get("teamId"),
            eq(schema.onshapeParts.partNumber, partNumber),
          ),
        );

      return c.json({
        success: true,
        partNumber,
        message: "Part deleted successfully",
      });
    } catch (err) {
      console.error("[Admin Parts] Delete error", err);
      return c.json(
        {
          error: err instanceof Error ? err.message : "Failed to delete part",
        },
        500,
      );
    }
  })
  /**
   * The team's Onshape connection. The key, secret and webhook signing keys are never sent back:
   * only whether they're set (and whether they're still the site team's worker secrets).
   */
  .get("/onshape/config", requireAdmin, async (c) => {
    const config = await onshapeConfig(c.env, createShopDb(c.env.SHOP_DB), c.get("teamId"));
    return c.json({
      documentId: config.documentId ?? "",
      mainAssemblyId: config.mainAssemblyId ?? "",
      companyId: config.companyId ?? "",
      hasApiKey: config.credentials !== null,
      hasWebhookKeys: config.webhookKeys !== null,
      fromWorkerSecrets: config.fromWorkerSecrets,
      webhookUrl: eventsUrl(c.env, c.get("teamId")),
    });
  })
  /**
   * Saves the team's Onshape connection (secrets left empty stay as they are), then registers
   * Shop's webhook on the document again, so it calls back on the team's own address.
   */
  .post("/onshape/config", requireAdmin, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = (key: string) =>
      typeof body[key] === "string" ? (body[key] as string).trim() : undefined;
    const documentId = text("documentId");
    if (!documentId) {
      return c.json({ error: "documentId is required" }, 400);
    }

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");

    try {
      const before = await onshapeConfig(c.env, db, teamId);
      await saveOnshapeConfig(c.env, db, teamId, {
        documentId,
        mainAssemblyId: text("mainAssemblyId"),
        companyId: text("companyId"),
        apiKey: text("apiKey"),
        apiSecret: text("apiSecret"),
        webhookKeyPrimary: text("webhookKeyPrimary"),
        webhookKeySecondary: text("webhookKeySecondary"),
      });
      const config = await onshapeConfig(c.env, db, teamId);

      // Replace our webhook: drop it from the old document (if it changed) and from this one, so
      // saving re-registers it at the current address instead of adding a second one.
      let webhook: "registered" | "failed" | "needs keys" = "needs keys";
      if (config.credentials && config.companyId) {
        const url = eventsUrl(c.env, teamId);
        if (before.documentId && before.documentId !== documentId && before.credentials) {
          console.log("[OnShape Config] Document ID changed, updating webhook registration");
          await unregisterOnShapeWebhooks(before.documentId, before.credentials, url);
        }
        await unregisterOnShapeWebhooks(documentId, config.credentials, url);
        try {
          await registerOnShapeWebhook(documentId, config.credentials, config.companyId, url);
          webhook = "registered";
        } catch (err) {
          console.error("[OnShape Config] Webhook registration failed", err);
          // Don't fail the config update if webhook registration fails
          webhook = "failed";
        }
      }

      return c.json({
        success: true,
        webhook,
        config: {
          documentId,
          mainAssemblyId: config.mainAssemblyId ?? undefined,
        },
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to update config" }, 500);
    }
  })
  .get("/slack/config", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const [release, summary] = await Promise.all([
      getSetting(db, teamId, RELEASE_CHANNEL_KEY),
      getSetting(db, teamId, SUMMARY_CHANNEL_KEY),
    ]);
    return c.json({ slackReleaseChannelId: release ?? "", slackSummaryChannelId: summary ?? "" });
  })
  .post("/slack/config", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const body = await c.req.json<{
      slackReleaseChannelId?: string;
      slackSummaryChannelId?: string;
    }>();
    const release = body.slackReleaseChannelId?.trim();
    const summary = body.slackSummaryChannelId?.trim();

    if (!release) {
      return c.json({ error: "Slack channel ID is required" }, 400);
    }

    try {
      const teamId = c.get("teamId");
      await setSetting(db, teamId, RELEASE_CHANNEL_KEY, release);
      if (summary) await setSetting(db, teamId, SUMMARY_CHANNEL_KEY, summary);
      return c.json({ slackReleaseChannelId: release, slackSummaryChannelId: summary ?? "" });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to update setting" },
        500,
      );
    }
  })
  // Posts the Overview (start of day) or Reflection (end of day) to the summary channel. The
  // browser sends the start of its local day and its time zone, since the worker runs in UTC.
  .post("/slack/daily-summary", requireAdmin, async (c) => {
    const body = await c.req.json<{
      kind?: unknown;
      since?: unknown;
      dayLabel?: unknown;
      timeZone?: unknown;
    }>();
    if (body.kind !== "overview" && body.kind !== "reflection") {
      return c.json({ error: 'kind must be "overview" or "reflection".' }, 400);
    }
    const now = Date.now();
    const since = Number(body.since);
    if (!Number.isFinite(since) || since > now || since < now - 36 * 60 * 60 * 1000) {
      return c.json({ error: "since must be the start of today (ms)." }, 400);
    }
    const dayLabel =
      typeof body.dayLabel === "string" && body.dayLabel.trim()
        ? body.dayLabel.trim().slice(0, 60)
        : new Date(since).toDateString();
    let timeZone = "UTC";
    if (typeof body.timeZone === "string") {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: body.timeZone });
        timeZone = body.timeZone;
      } catch {}
    }

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const channel = await getSetting(db, teamId, SUMMARY_CHANNEL_KEY);
    if (!channel) {
      return c.json({ error: "Set the daily summary channel in Slack Configuration first." }, 400);
    }

    let text: string;
    if (body.kind === "overview") {
      text = formatOverview(await getOverviewStats(db, teamId), { dayLabel, now });
    } else {
      const stats = await getReflectionStats(db, teamId, since);
      const names = new Map<string, string>();
      const ids = stats.byUser.slice(0, 3).map((u) => u.userId);
      if (ids.length > 0) {
        const res = await c.env.G3ID.fetch(
          new Request(`http://g3id/api/auth/users?ids=${encodeURIComponent(ids.join(","))}`, {
            headers: { cookie: c.req.header("Cookie") ?? "" },
          }),
        );
        if (res.ok) {
          for (const u of (await res.json()) as { id: string; displayName: string }[]) {
            names.set(u.id, u.displayName);
          }
        }
      }
      text = formatReflection(stats, { dayLabel, timeZone, names });
    }

    // On the team's own Slack (G3ID holds its bot token).
    const sent = await sendTeamMessage(c.env, teamId, channel, text);
    if (!sent.ok) {
      const reason = sent.error;
      const hint = reason.includes("not_in_channel") ? " Invite the Slack bot to the channel." : "";
      return c.json({ error: `Couldn't post to Slack: ${reason}.${hint}` }, 502);
    }
    return c.json({ text, channel });
  })
  .delete("/obsolete-instances", requireAdmin, async (c) => {
    try {
      const db = createShopDb(c.env.SHOP_DB);
      const teamId = c.get("teamId");

      // First, get all stale instance IDs
      const staleInstances = await db
        .select({ id: schema.partInstances.id })
        .from(schema.partInstances)
        .where(inTeam(schema.partInstances, teamId, eq(schema.partInstances.isStale, 1)));

      const staleInstanceIds = staleInstances.map((i) => i.id);

      if (staleInstanceIds.length === 0) {
        return c.json({
          success: true,
          message: "No obsolete instances to delete",
        });
      }

      const batchSize = 100;

      // Delete associated actions (actions table has FK to part_instances)
      for (let i = 0; i < staleInstanceIds.length; i += batchSize) {
        const batch = staleInstanceIds.slice(i, i + batchSize);
        await db
          .delete(schema.actions)
          .where(inTeam(schema.actions, teamId, inArray(schema.actions.partInstanceId, batch)));
      }

      // Delete associated processes (part_instance_processes has FK to part_instances)
      for (let i = 0; i < staleInstanceIds.length; i += batchSize) {
        const batch = staleInstanceIds.slice(i, i + batchSize);
        await db
          .delete(schema.partInstanceProcesses)
          .where(
            inTeam(
              schema.partInstanceProcesses,
              teamId,
              inArray(schema.partInstanceProcesses.partInstanceId, batch),
            ),
          );
      }

      // Finally delete the stale instances
      await db
        .delete(schema.partInstances)
        .where(inTeam(schema.partInstances, teamId, eq(schema.partInstances.isStale, 1)));

      return c.json({
        success: true,
        message: `Deleted ${staleInstanceIds.length} obsolete instances`,
      });
    } catch (err) {
      console.error("[Delete Obsolete Instances Error]", err);
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to delete obsolete instances" },
        500,
      );
    }
  });
