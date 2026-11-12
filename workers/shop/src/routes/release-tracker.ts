import { inTeam, logTeamChange, requireAdmin, withTeam } from "@g3/auth";
import { Hono } from "hono";
import { createShopDb } from "../db";
import * as schema from "../db/schema";
import { onshapeFetch } from "../lib/onshape-api";
import { onshapeConfig } from "../lib/onshape-config";
import { registerOnShapeWebhook, unregisterOnShapeWebhooks } from "../lib/onshape-webhook";
import {
  parseTrackingUrl,
  stopTracker,
  syncTrackerNow,
  trackerReport,
} from "../lib/release-tracker";
import { shopUrl } from "../lib/urls";
import type { AppEnv } from "../types";

// The release tracker on Shop's Admin page (admins only): link the tracking document, sync now,
// or stop. Syncs run on the queue (lib/release-tracker.ts).
export const releaseTrackerRouter = new Hono<AppEnv>()
  .get("/", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const config = await onshapeConfig(c.env, db, teamId);
    return c.json({
      // Onshape has to be connected first: the tracker copies from its document with its keys.
      ready: Boolean(config.credentials && config.documentId),
      tracker: await trackerReport(db, teamId, config.documentId),
    });
  })
  // Links the tracking document (any address in it, from its main workspace) and syncs.
  .put("/", requireAdmin, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null;
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const config = await onshapeConfig(c.env, db, teamId);
    if (!config.credentials || !config.documentId) {
      return c.json({ error: "Connect Onshape first, under Onshape Configuration." }, 400);
    }
    const target = typeof body?.url === "string" ? parseTrackingUrl(body.url) : null;
    if (!target) {
      return c.json(
        { error: "Paste the tracking document's address from your browser, with /w/ in it." },
        400,
      );
    }
    if (target.documentId === config.documentId) {
      return c.json(
        { error: "Choose a separate document. The tracker copies your part studios into it." },
        400,
      );
    }

    // One call, so a document the keys can't open is caught now, not on every sync.
    const api = { db, teamId, credentials: config.credentials };
    const check = await onshapeFetch(
      api,
      "tracker_document",
      `/v10/documents/${target.documentId}`,
    );
    if (!check.ok) {
      return c.json(
        {
          error:
            check.status === 403 || check.status === 404
              ? "Shop's Onshape keys can't open that document. Share it with the account the keys belong to, with edit access."
              : `Onshape answered ${check.status}. Try again in a moment.`,
        },
        400,
      );
    }

    const t = schema.releaseTrackers;
    const before = await db.select().from(t).where(inTeam(t, teamId)).get();
    // A different tracking document starts over; its copies in the old one are left there.
    if (before && before.documentId !== target.documentId) await stopTracker(db, teamId);
    const values = {
      sourceDocumentId: config.documentId,
      documentId: target.documentId,
      workspaceId: target.workspaceId,
      error: null,
      refresh: 1,
    };
    await db
      .insert(t)
      .values(withTeam(teamId, { ...values, createdBy: c.get("userId"), createdAt: Date.now() }))
      .onConflictDoUpdate({ target: [t.teamId], set: values });

    // The webhook again, so it also sends new versions (teams set up before the tracker).
    let webhook: "registered" | "failed" | "needs company" = "needs company";
    if (config.companyId) {
      const url = `${shopUrl(c.env, teamId)}/api/onshape/events`;
      try {
        await unregisterOnShapeWebhooks(config.documentId, api, url);
        await registerOnShapeWebhook(config.documentId, api, config.companyId, url);
        webhook = "registered";
      } catch (err) {
        console.error("[Release tracker] Webhook not registered", err);
        webhook = "failed";
      }
    }

    await syncTrackerNow(c.env, db, teamId);
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "shop",
      what: "Release tracker",
      changed: ["Tracking document"],
    });
    return c.json({ webhook, tracker: await trackerReport(db, teamId, config.documentId) });
  })
  .post("/sync", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const config = await onshapeConfig(c.env, db, teamId);
    const tracker = await trackerReport(db, teamId, config.documentId);
    if (!tracker) return c.json({ error: "Set up the release tracker first." }, 404);
    await syncTrackerNow(c.env, db, teamId);
    return c.json({ tracker });
  })
  // Stops tracking. The tracking document stays in Onshape as it is.
  .delete("/", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    await stopTracker(db, teamId);
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "shop",
      what: "Release tracker",
      changed: ["Stopped"],
    });
    return c.json({ ok: true });
  });
