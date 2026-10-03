import { requireAdmin, requireAuth } from "@g3/auth";
import { sendMessage } from "@g3/slack";
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
import { exportDrawingAsPDF, storeDrawingInR2 } from "../lib/onshape-export";
import { registerOnShapeWebhook, unregisterOnShapeWebhooks } from "../lib/onshape-webhook";
import type { AppEnv } from "../types";

const RELEASE_CHANNEL_KEY = "slack_release_channel_id";
const SUMMARY_CHANNEL_KEY = "slack_summary_channel_id";

async function getSetting(db: ReturnType<typeof createShopDb>, key: string) {
  const row = await db
    .select({ value: schema.adminSettings.value })
    .from(schema.adminSettings)
    .where(eq(schema.adminSettings.key, key))
    .get();
  return row?.value || null;
}

async function setSetting(db: ReturnType<typeof createShopDb>, key: string, value: string) {
  const updatedAt = Math.floor(Date.now() / 1000);
  await db
    .insert(schema.adminSettings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: schema.adminSettings.key, set: { value, updatedAt } });
}

export const adminPartsRouter = new Hono<AppEnv>()
  .get("/parts/pending", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);

    // Get all parts from onshapeParts and partDefinitions
    const onshapeParts = await db.select().from(schema.onshapeParts).all();
    const definitions = await db.select().from(schema.partDefinitions).all();

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

    const subsystems = await db.select().from(schema.subsystems).all();

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

      // Get the OnShape part info
      const part = await db
        .select()
        .from(schema.onshapeParts)
        .where(eq(schema.onshapeParts.partNumber, partNumber))
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

      // Get document ID from database
      const docIdSetting = await db
        .select()
        .from(schema.adminSettings)
        .where(eq(schema.adminSettings.key, "onshape_document_id"))
        .get();
      const documentId = docIdSetting?.value;

      if (!documentId) {
        return c.json({ error: "Document ID not configured" }, 400);
      }

      // Fetch the drawing
      const pdfBuffer = await exportDrawingAsPDF(
        documentId,
        part.versionId,
        part.partDrawingEntityId,
        c.env,
      );

      // Store in R2 with revision in path (stamps the part-number barcode on the way in)
      await storeDrawingInR2(partNumber, revision, pdfBuffer, c.env);

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
      await db.delete(schema.onshapeParts).where(eq(schema.onshapeParts.partNumber, partNumber));

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
  .get("/onshape/config", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);

    const [docIdSetting, mainAssemblyIdSetting] = await Promise.all([
      db
        .select()
        .from(schema.adminSettings)
        .where(eq(schema.adminSettings.key, "onshape_document_id"))
        .get(),
      db
        .select()
        .from(schema.adminSettings)
        .where(eq(schema.adminSettings.key, "onshape_main_assembly_id"))
        .get(),
    ]);

    return c.json({
      documentId: docIdSetting?.value || "",
      mainAssemblyId: mainAssemblyIdSetting?.value || "",
    });
  })
  .post("/onshape/config", requireAdmin, async (c) => {
    const body = await c.req.json<{ documentId?: string; mainAssemblyId?: string }>();

    if (!body.documentId || !body.documentId.trim()) {
      return c.json({ error: "documentId is required" }, 400);
    }

    const db = createShopDb(c.env.SHOP_DB);
    const now = Math.floor(Date.now() / 1000);

    try {
      // Get old document ID for webhook cleanup
      const existingDocId = await db
        .select()
        .from(schema.adminSettings)
        .where(eq(schema.adminSettings.key, "onshape_document_id"))
        .get();

      const oldDocId = existingDocId?.value;

      // Update or insert documentId
      if (existingDocId) {
        await db
          .update(schema.adminSettings)
          .set({
            value: body.documentId.trim(),
            updatedAt: now,
          })
          .where(eq(schema.adminSettings.key, "onshape_document_id"));
      } else {
        await db.insert(schema.adminSettings).values({
          key: "onshape_document_id",
          value: body.documentId.trim(),
          updatedAt: now,
        });
      }

      // Update or insert mainAssemblyId if provided
      if (body.mainAssemblyId?.trim()) {
        const existingMainAssemblyId = await db
          .select()
          .from(schema.adminSettings)
          .where(eq(schema.adminSettings.key, "onshape_main_assembly_id"))
          .get();

        if (existingMainAssemblyId) {
          await db
            .update(schema.adminSettings)
            .set({
              value: body.mainAssemblyId.trim(),
              updatedAt: now,
            })
            .where(eq(schema.adminSettings.key, "onshape_main_assembly_id"));
        } else {
          await db.insert(schema.adminSettings).values({
            key: "onshape_main_assembly_id",
            value: body.mainAssemblyId.trim(),
            updatedAt: now,
          });
        }
      }

      // Unregister old webhook and register new one
      if (oldDocId && oldDocId !== body.documentId.trim()) {
        console.log("[OnShape Config] Document ID changed, updating webhook registration");
        await unregisterOnShapeWebhooks(oldDocId, c.env);
      }

      try {
        await registerOnShapeWebhook(body.documentId.trim(), c.env);
      } catch (err) {
        console.error("[OnShape Config] Webhook registration failed", err);
        // Don't fail the config update if webhook registration fails
      }

      return c.json({
        success: true,
        config: {
          documentId: body.documentId.trim(),
          mainAssemblyId: body.mainAssemblyId?.trim() || undefined,
        },
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to update config" }, 500);
    }
  })
  .get("/slack/config", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const [release, summary] = await Promise.all([
      getSetting(db, RELEASE_CHANNEL_KEY),
      getSetting(db, SUMMARY_CHANNEL_KEY),
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
      await setSetting(db, RELEASE_CHANNEL_KEY, release);
      if (summary) await setSetting(db, SUMMARY_CHANNEL_KEY, summary);
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
    const channel = await getSetting(db, SUMMARY_CHANNEL_KEY);
    if (!channel) {
      return c.json({ error: "Set the daily summary channel in Slack Configuration first." }, 400);
    }

    let text: string;
    if (body.kind === "overview") {
      text = formatOverview(await getOverviewStats(db), { dayLabel, now });
    } else {
      const stats = await getReflectionStats(db, since);
      const names = new Map<string, string>();
      const ids = stats.byUser.slice(0, 3).map((u) => u.userId);
      if (ids.length > 0) {
        const res = await c.env.G3ID.fetch(
          new Request(`http://g3id/auth/users?ids=${encodeURIComponent(ids.join(","))}`, {
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

    try {
      await sendMessage(channel, text, c.env);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Slack request failed";
      const hint = reason.includes("not_in_channel") ? " Invite the Slack bot to the channel." : "";
      return c.json({ error: `Couldn't post to Slack: ${reason}.${hint}` }, 502);
    }
    return c.json({ text, channel });
  })
  .delete("/obsolete-instances", requireAdmin, async (c) => {
    try {
      const db = createShopDb(c.env.SHOP_DB);

      // First, get all stale instance IDs
      const staleInstances = await db
        .select({ id: schema.partInstances.id })
        .from(schema.partInstances)
        .where(eq(schema.partInstances.isStale, 1));

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
        await db.delete(schema.actions).where(inArray(schema.actions.partInstanceId, batch));
      }

      // Delete associated processes (part_instance_processes has FK to part_instances)
      for (let i = 0; i < staleInstanceIds.length; i += batchSize) {
        const batch = staleInstanceIds.slice(i, i + batchSize);
        await db
          .delete(schema.partInstanceProcesses)
          .where(inArray(schema.partInstanceProcesses.partInstanceId, batch));
      }

      // Finally delete the stale instances
      await db.delete(schema.partInstances).where(eq(schema.partInstances.isStale, 1));

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
