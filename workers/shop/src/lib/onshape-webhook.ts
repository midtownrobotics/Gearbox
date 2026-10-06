import { apiUrl, site } from "@g3/site-config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv } from "../types";

/** Our webhook's name in Onshape; how we find it again to delete it. */
const WEBHOOK_NAME = `${site.team.name} Shop SW`;

interface BOMHeader {
  id: string;
  propertyName: string;
  label: string;
}

interface BOMRow {
  headerIdToValue: Record<string, string | number | boolean | null>;
}

interface BOMData {
  headers: BOMHeader[];
  rows: BOMRow[];
}

export const ONSHAPE_WEBHOOK_EVENTS = ["onshape.revision.created", "onshape.workflow.transition"];

export async function verifyOnshapeSignature(
  timestamp: string,
  rawBody: string,
  primaryKey: string,
  secondaryKey: string,
  primarySignature: string,
  secondarySignature: string,
): Promise<boolean> {
  const message = `${timestamp}.${rawBody}`;

  const verifyKey = async (key: string, signature: string): Promise<boolean> => {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );

      const signatureBytes = await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        new TextEncoder().encode(message),
      );

      const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));

      return base64Signature === signature;
    } catch {
      return false;
    }
  };

  const primaryMatch = await verifyKey(primaryKey, primarySignature);
  if (primaryMatch) return true;

  const secondaryMatch = await verifyKey(secondaryKey, secondarySignature);
  return secondaryMatch;
}

export async function unregisterOnShapeWebhooks(documentId: string, env: AppEnv["Bindings"]) {
  const apiKey = env.ONSHAPE_API_KEY;
  const apiSecret = env.ONSHAPE_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.warn("[OnShape] Cannot unregister webhooks: credentials missing");
    return;
  }

  const credentials = btoa(`${apiKey}:${apiSecret}`);

  try {
    // List all webhooks for this document
    const listResponse = await fetch(
      `https://cad.onshape.com/api/v16/webhooks?documentId=${documentId}`,
      {
        headers: {
          Authorization: `Basic ${credentials}`,
        },
      },
    );

    if (!listResponse.ok) {
      console.warn("[OnShape] Failed to list webhooks for cleanup");
      return;
    }

    const webhooks = (await listResponse.json()) as { items: { id: string; name: string }[] };

    // Delete our webhook
    for (const webhook of webhooks.items || []) {
      if (webhook.name === WEBHOOK_NAME) {
        const deleteResponse = await fetch(
          `https://cad.onshape.com/api/v16/webhooks/${webhook.id}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Basic ${credentials}`,
            },
          },
        );

        if (deleteResponse.ok) {
          console.log("[OnShape Webhook Unregistered]", { documentId, webhookId: webhook.id });
        }
      }
    }
  } catch (err) {
    console.warn(
      "[OnShape] Error cleaning up webhooks:",
      err instanceof Error ? err.message : "Unknown error",
    );
  }
}

export async function registerOnShapeWebhook(documentId: string, env: AppEnv["Bindings"]) {
  const apiKey = env.ONSHAPE_API_KEY;
  const apiSecret = env.ONSHAPE_API_SECRET;
  const companyId = env.ONSHAPE_COMPANY_ID;

  if (!apiKey || !apiSecret || !companyId) {
    throw new Error("OnShape API credentials not configured");
  }

  const credentials = btoa(`${apiKey}:${apiSecret}`);
  const webhookUrl = `${apiUrl("shop")}/onshape/events`;

  const response = await fetch("https://cad.onshape.com/api/v16/webhooks", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      documentId,
      companyId,
      events: ONSHAPE_WEBHOOK_EVENTS,
      url: webhookUrl,
      isTransient: false,
      options: {
        collapseEvents: false,
      },
      name: WEBHOOK_NAME,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[OnShape Webhook Register Error]", error);
    throw new Error(`Failed to register OnShape webhook: ${response.status}`);
  }

  const data = (await response.json()) as { id: string };
  console.log("[OnShape Webhook Registered]", {
    documentId,
    webhookId: data.id,
    events: ONSHAPE_WEBHOOK_EVENTS,
  });
  return data;
}

export async function processRevisionEvent(
  elementId: string,
  elementType: number,
  partNumber: string,
  onshapeReleaseId: string,
  versionId: string,
  env: AppEnv["Bindings"],
): Promise<void> {
  const database = drizzle(env.SHOP_DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  const isDrawing = elementType === 2;
  const isPart = elementType === 0;

  const updateData: { entityId?: string; partDrawingEntityId?: string; versionId: string } = {
    versionId,
  };

  if (isPart) updateData.entityId = elementId;
  if (isDrawing) updateData.partDrawingEntityId = elementId;

  await database
    .insert(schema.onshapeParts)
    .values({
      onshapeReleaseId,
      partNumber,
      ...updateData,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.onshapeParts.onshapeReleaseId, schema.onshapeParts.partNumber],
      set: updateData,
    });

  console.log("[OnShape Webhook] Updated part", {
    partNumber,
    onshapeReleaseId,
    versionId,
    elementType,
  });
}

export async function fetchAndParseBOM(
  documentId: string,
  versionId: string,
  mainAssemblyId: string,
  apiKey: string,
  apiSecret: string,
): Promise<
  Map<string, { quantity?: number; name?: string; description?: string; revision?: string }>
> {
  const bomStartTime = Date.now();
  const credentials = btoa(`${apiKey}:${apiSecret}`);
  const bomUrl = `https://cad.onshape.com/api/v16/assemblies/d/${documentId}/v/${versionId}/e/${mainAssemblyId}/bom?indented=false`;

  try {
    console.log("[BOM Fetch] Starting BOM request");
    const response = await fetch(bomUrl, {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    });
    console.log(
      `[BOM Fetch] Response received after ${Date.now() - bomStartTime}ms, status: ${response.status}`,
    );

    if (!response.ok) {
      console.error("[BOM Fetch Error]", response.status, response.statusText);
      return new Map();
    }

    console.log("[BOM Fetch] Parsing response JSON");
    const bom = (await response.json()) as BOMData;
    console.log(
      `[BOM Fetch] JSON parsed after ${Date.now() - bomStartTime}ms, ${bom.rows.length} rows`,
    );
    const partMetadata = new Map<
      string,
      { quantity?: number; name?: string; description?: string; revision?: string }
    >();

    // Find property IDs from headers
    const propertyIds: Record<string, string> = {};
    for (const header of bom.headers) {
      if (header.propertyName === "partNumber") propertyIds.partNumber = header.id;
      if (header.propertyName === "quantity") propertyIds.quantity = header.id;
      if (header.propertyName === "name") propertyIds.name = header.id;
      if (header.propertyName === "description") propertyIds.description = header.id;
      if (header.propertyName === "revision") propertyIds.revision = header.id;
    }

    // Parse rows to extract metadata by part number
    for (const row of bom.rows) {
      const partNumberId = propertyIds.partNumber;
      if (partNumberId && row.headerIdToValue[partNumberId]) {
        const partNumber = String(row.headerIdToValue[partNumberId]);

        const metadata: {
          quantity?: number;
          name?: string;
          description?: string;
          revision?: string;
        } = {};

        const quantityId = propertyIds.quantity;
        if (quantityId && row.headerIdToValue[quantityId]) {
          const qty = row.headerIdToValue[quantityId];
          if (typeof qty === "number") metadata.quantity = qty;
        }

        const nameId = propertyIds.name;
        if (nameId && row.headerIdToValue[nameId]) {
          const val = row.headerIdToValue[nameId];
          if (val) metadata.name = String(val);
        }

        const descriptionId = propertyIds.description;
        if (descriptionId && row.headerIdToValue[descriptionId]) {
          const val = row.headerIdToValue[descriptionId];
          if (val) metadata.description = String(val);
        }

        const revisionId = propertyIds.revision;
        if (revisionId && row.headerIdToValue[revisionId]) {
          const val = row.headerIdToValue[revisionId];
          if (val) metadata.revision = String(val);
        }

        if (Object.keys(metadata).length > 0) {
          partMetadata.set(partNumber, metadata);
        }
      }
    }

    console.log(
      `[BOM Fetch] Parsing complete after ${Date.now() - bomStartTime}ms, found ${partMetadata.size} parts with metadata`,
    );
    return partMetadata;
  } catch (err) {
    console.error("[BOM Parse Error]", err);
    return new Map();
  }
}

export async function processReleaseEvent(
  releaseId: string,
  timestamp: string,
  env: AppEnv["Bindings"],
  queue: Queue,
): Promise<void> {
  const startTime = Date.now();
  console.log(`[OnShape Webhook] Starting processReleaseEvent for ${releaseId}`);

  const database = drizzle(env.SHOP_DB, { schema });
  const now = Math.floor(Date.now() / 1000);

  console.log(`[OnShape Webhook] [${Date.now() - startTime}ms] Inserting release`);
  const release = await database
    .insert(schema.onshapeReleases)
    .values({
      releaseId,
      timestamp,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: schema.onshapeReleases.releaseId,
      set: { timestamp },
    })
    .returning({ id: schema.onshapeReleases.id });

  const releaseRowId = release[0]?.id;
  if (!releaseRowId) {
    console.error("[OnShape] Failed to create release row");
    return;
  }

  console.log(`[OnShape Webhook] [${Date.now() - startTime}ms] Updating existing parts`);
  const existingParts = await database
    .select()
    .from(schema.onshapeParts)
    .where(eq(schema.onshapeParts.onshapeReleaseId, releaseId));

  for (const part of existingParts) {
    if (!part.releaseId) {
      await database
        .update(schema.onshapeParts)
        .set({ releaseId: releaseRowId })
        .where(eq(schema.onshapeParts.id, part.id));
    }
  }

  console.log(`[OnShape Webhook] [${Date.now() - startTime}ms] Waiting 5 seconds`);
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Query parts for this release
  console.log(`[OnShape Webhook] [${Date.now() - startTime}ms] Querying parts`);
  const parts = await database
    .select()
    .from(schema.onshapeParts)
    .where(eq(schema.onshapeParts.releaseId, releaseRowId));

  console.log(`[OnShape Webhook] [${Date.now() - startTime}ms] Found ${parts.length} parts`);

  // Queue BOM fetch job for async processing
  console.log(`[OnShape Webhook] [${Date.now() - startTime}ms] Queuing BOM fetch job`);
  await queue.send({
    releaseId,
    releaseRowId,
    timestamp,
  });

  const totalTime = Date.now() - startTime;
  console.log("[OnShape Webhook] Release processed, BOM job queued", {
    releaseId,
    partCount: parts.length,
    totalTimeMs: totalTime,
  });
}
