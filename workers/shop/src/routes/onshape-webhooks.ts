import { requestTeamId } from "@g3/auth";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { onshapeConfig } from "../lib/onshape-config";
import {
  processReleaseEvent,
  processRevisionEvent,
  verifyOnshapeSignature,
} from "../lib/onshape-webhook";
import type { AppEnv } from "../types";

// Onshape's webhook events. Each team's webhook calls back on its own address
// (<number>-shop.<platform>/api/onshape/events), so the gateway's team is the event's team; it's
// believed only when the event is signed with that team's webhook keys. Onshape doesn't sign in, so
// this answers 200 whatever happens (it retries anything else).

const router = new Hono<AppEnv>();

router.post("/events", async (c) => {
  const teamId = requestTeamId(c);
  const timestamp = c.req.header("X-onshape-webhook-timestamp");
  const primarySignature = c.req.header("X-onshape-webhook-signature-primary");
  const secondarySignature = c.req.header("X-onshape-webhook-signature-secondary");

  if (!timestamp || !primarySignature || !secondarySignature) {
    console.error("[OnShape Webhook] Missing signature headers");
    return c.json({ ok: true });
  }

  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    console.error("[OnShape Webhook] Failed to read raw body");
    return c.json({ ok: true });
  }

  const db = createShopDb(c.env.SHOP_DB);
  const { webhookKeys } = await onshapeConfig(c.env, db, teamId);
  if (!webhookKeys) {
    console.error("[OnShape Webhook] No webhook keys saved for this team", { teamId });
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
    return c.json({ ok: true });
  }

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
