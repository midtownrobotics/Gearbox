// SPDX-License-Identifier: AGPL-3.0-only
import { inTeam, withTeam } from "@g3/auth";
import { eq } from "drizzle-orm";
import type { createShopDb } from "../db";
import * as schema from "../db/schema";
import type { BOMQueueMessage } from "./bom-queue-consumer";
import { type OnshapeApi, onshapeFetch } from "./onshape-api";

type ShopDb = ReturnType<typeof createShopDb>;

/** Our webhook's name in Onshape; with its address, how we find it again to delete it. */
const WEBHOOK_NAME = "Gearbox Shop";

/** How long a release event waits for its revision events. */
export const REVISIONS_WAIT_MS = 5000;

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

/**
 * Whether an event is signed with the team's keys. Onshape sends a signature header for each key
 * set in the company's settings (the secondary only when there is one), so either matching is
 * enough.
 */
export async function verifyOnshapeSignature(
  timestamp: string,
  rawBody: string,
  primaryKey: string,
  secondaryKey: string,
  primarySignature: string | undefined,
  secondarySignature: string | undefined,
): Promise<boolean> {
  const message = `${timestamp}.${rawBody}`;

  const verifyKey = async (key: string, signature: string | undefined): Promise<boolean> => {
    if (!signature) return false;
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

  // Either header may have been signed with either key while an admin is swapping them.
  for (const signature of [primarySignature, secondarySignature]) {
    if (await verifyKey(primaryKey, signature)) return true;
    if (secondaryKey !== primaryKey && (await verifyKey(secondaryKey, signature))) return true;
  }
  return false;
}

type OnshapeWebhook = { id: string; name?: string; url?: string };

/**
 * Deletes Shop's webhook from a document: any that calls back on this team's events address, or
 * carries our name. Onshape keeps webhooks per document, so saving the config again replaces
 * ours instead of adding a second.
 */
export async function unregisterOnShapeWebhooks(
  documentId: string,
  api: OnshapeApi,
  eventsUrl: string,
) {
  try {
    const listResponse = await onshapeFetch(
      api,
      "webhook_list",
      `/v16/webhooks?documentId=${documentId}`,
    );
    if (!listResponse.ok) {
      console.warn("[OnShape] Failed to list webhooks for cleanup");
      return;
    }
    const webhooks = (await listResponse.json()) as { items?: OnshapeWebhook[] };
    for (const webhook of webhooks.items ?? []) {
      if (webhook.url !== eventsUrl && webhook.name !== WEBHOOK_NAME) continue;
      const deleteResponse = await onshapeFetch(
        api,
        "webhook_delete",
        `/v16/webhooks/${webhook.id}`,
        { method: "DELETE" },
      );
      if (deleteResponse.ok) {
        console.log("[OnShape Webhook Unregistered]", { documentId, webhookId: webhook.id });
      }
    }
  } catch (err) {
    console.warn(
      "[OnShape] Error cleaning up webhooks:",
      err instanceof Error ? err.message : "Unknown error",
    );
  }
}

/** Registers Shop's webhook on a document, calling back on the team's own events address. */
export async function registerOnShapeWebhook(
  documentId: string,
  api: OnshapeApi,
  companyId: string,
  eventsUrl: string,
) {
  const response = await onshapeFetch(api, "webhook_create", "/v16/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId,
      companyId,
      events: ONSHAPE_WEBHOOK_EVENTS,
      url: eventsUrl,
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

/** A revision Onshape made for one part or drawing of a release in the team's document. */
export type RevisionEvent = {
  documentId: string | null;
  elementId: string;
  elementType: number;
  partNumber: string;
  releaseId: string;
  versionId: string;
  timestamp: string;
};

/**
 * Records the part, and its release with the document the revision came from: a release is the
 * team's once one of its revisions is (`processReleaseEvent`).
 */
export async function processRevisionEvent(
  db: ShopDb,
  teamId: string,
  revision: RevisionEvent,
): Promise<void> {
  const { documentId, elementId, elementType, partNumber, releaseId, versionId } = revision;
  const now = Math.floor(Date.now() / 1000);

  const [release] = await db
    .insert(schema.onshapeReleases)
    .values(
      withTeam(teamId, { releaseId, timestamp: revision.timestamp, documentId, createdAt: now }),
    )
    .onConflictDoUpdate({
      target: [schema.onshapeReleases.teamId, schema.onshapeReleases.releaseId],
      set: { documentId },
    })
    .returning({ id: schema.onshapeReleases.id });

  const updateData: {
    entityId?: string;
    partDrawingEntityId?: string;
    versionId: string;
    releaseId?: number;
  } = { versionId, releaseId: release?.id };
  if (elementType === 0) updateData.entityId = elementId;
  if (elementType === 2) updateData.partDrawingEntityId = elementId;

  await db
    .insert(schema.onshapeParts)
    .values(
      withTeam(teamId, {
        onshapeReleaseId: releaseId,
        partNumber,
        ...updateData,
        createdAt: now,
      }),
    )
    .onConflictDoUpdate({
      target: [
        schema.onshapeParts.teamId,
        schema.onshapeParts.onshapeReleaseId,
        schema.onshapeParts.partNumber,
      ],
      set: updateData,
    });

  console.log("[OnShape Webhook] Updated part", {
    teamId,
    partNumber,
    onshapeReleaseId: releaseId,
    versionId,
    elementType,
  });
}

export async function fetchAndParseBOM(
  documentId: string,
  versionId: string,
  mainAssemblyId: string,
  api: OnshapeApi,
): Promise<
  Map<string, { quantity?: number; name?: string; description?: string; revision?: string }>
> {
  const bomStartTime = Date.now();
  const bomPath = `/v16/assemblies/d/${documentId}/v/${versionId}/e/${mainAssemblyId}/bom?indented=false`;

  try {
    console.log("[BOM Fetch] Starting BOM request");
    const response = await onshapeFetch(api, "bom", bomPath);
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

/**
 * An approved release: once its revisions have come in (a few seconds), queues the job that reads
 * it. A release no revision recorded is another document's (or has no parts), and is dropped
 * without asking Onshape.
 */
export async function processReleaseEvent(
  database: ShopDb,
  teamId: string,
  releaseId: string,
  timestamp: string,
  queue: Queue,
  wait = REVISIONS_WAIT_MS,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, wait));

  const [release] = await database
    .update(schema.onshapeReleases)
    .set({ timestamp })
    .where(inTeam(schema.onshapeReleases, teamId, eq(schema.onshapeReleases.releaseId, releaseId)))
    .returning({ id: schema.onshapeReleases.id });

  if (!release) {
    console.log("[OnShape Webhook] Release with no revisions from the team's document, ignored", {
      teamId,
      releaseId,
    });
    return;
  }

  await queue.send({
    teamId,
    releaseId,
    releaseRowId: release.id,
    timestamp,
  } satisfies BOMQueueMessage);
  console.log("[OnShape Webhook] Release queued", { teamId, releaseId });
}
