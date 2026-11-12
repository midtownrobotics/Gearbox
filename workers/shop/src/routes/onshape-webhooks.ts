// SPDX-License-Identifier: AGPL-3.0-only
import { requestTeamId } from "@g3/auth";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { onshapeConfig } from "../lib/onshape-config";
import {
  processReleaseEvent,
  processRevisionEvent,
  verifyOnshapeSignature,
} from "../lib/onshape-webhook";
import { clearWebhookProblem, noteWebhookProblem } from "../lib/onshape-webhook-health";
import type { AppEnv } from "../types";

// Onshape's webhook events. Each team's webhook calls back on its own address
// (<number>-shop.<platform>/api/onshape/events), so the gateway's team is the event's team; it's
// believed only when the event is signed with that team's webhook keys. Onshape doesn't sign in, so
// this answers 200 whatever happens (it retries anything else). Why an event was dropped is kept for
// the banner (lib/onshape-webhook-health.ts).

const router = new Hono<AppEnv>();

router.post("/events", async (c) => {
  const teamId = requestTeamId(c);
  const timestamp = c.req.header("X-onshape-webhook-timestamp");
  const primarySignature = c.req.header("X-onshape-webhook-signature-primary");
  const secondarySignature = c.req.header("X-onshape-webhook-signature-secondary");

  const db = createShopDb(c.env.SHOP_DB);

  // Onshape signs events only once signing keys are set in the company's settings (Webhooks).
  if (!timestamp || (!primarySignature && !secondarySignature)) {
    console.error("[OnShape Webhook] Event isn't signed: no signing keys in Onshape", { teamId });
    await noteWebhookProblem(db, teamId, "unsigned");
    return c.json({ ok: true });
  }

  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    console.error("[OnShape Webhook] Failed to read raw body");
    return c.json({ ok: true });
  }

  const { webhookKeys } = await onshapeConfig(c.env, db, teamId);
  if (!webhookKeys) {
    console.error("[OnShape Webhook] No webhook keys saved for this team", { teamId });
    await noteWebhookProblem(db, teamId, "no keys");
    return c.json({ ok: true });
  }

  const isValid = await verifyOnshapeSignature(
    timestamp,
    rawBody,
    webhookKeys.primary,
    webhookKeys.secondary,
    primarySignature,
    secondarySignature,
  );

  if (!isValid) {
    console.error("[OnShape Webhook] Invalid signature", { teamId });
    await noteWebhookProblem(db, teamId, "wrong keys");
    return c.json({ ok: true });
  }
  await clearWebhookProblem(db, teamId);

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error("[OnShape Webhook] Failed to parse body");
    return c.json({ ok: true });
  }

  const webhookData = body as {
    event?: string;
    elementType?: number;
    elementId?: string;
    partNumber?: string;
    releaseId?: string;
    versionId?: string;
    objectType?: string;
    objectId?: string;
    timestamp?: string;
    transitionName?: string;
  };

  if (typeof webhookData !== "object" || !webhookData || !webhookData.event) {
    return c.json({ ok: true });
  }

  console.log("[OnShape Webhook]", webhookData.event, { teamId, ...webhookData });

  if (webhookData.event === "webhook.register" || webhookData.event === "webhook.ping") {
    return c.json({ ok: true });
  }

  if (webhookData.event === "onshape.revision.created") {
    const { elementType, elementId, partNumber, releaseId, versionId } = webhookData;
    if (typeof elementType === "number" && elementId && partNumber && releaseId && versionId) {
      c.executionCtx.waitUntil(
        processRevisionEvent(db, teamId, elementId, elementType, partNumber, releaseId, versionId),
      );
    } else {
      console.warn("[OnShape Webhook] Revision event missing required fields", {
        elementType,
        elementId,
        partNumber,
        releaseId,
        versionId,
      });
    }
    return c.json({ ok: true });
  }

  if (
    webhookData.event === "onshape.workflow.transition" &&
    webhookData.objectType === "RELEASE" &&
    webhookData.transitionName === "RELEASE"
  ) {
    const { objectId: releaseId, timestamp } = webhookData;
    if (releaseId && timestamp) {
      c.executionCtx.waitUntil(
        processReleaseEvent(db, teamId, releaseId, timestamp, c.env.BOM_QUEUE),
      );
    }
    return c.json({ ok: true });
  }

  return c.json({ ok: true });
});

export const onshapeWebhooksRouter = router;
