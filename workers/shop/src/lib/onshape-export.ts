import { inTeam } from "@g3/auth";
import { desc, eq } from "drizzle-orm";
import type { createShopDb } from "../db";
import * as schema from "../db/schema";
import type { AppEnv } from "../types";
import { drawingBarcodeValue, stampBarcode } from "./barcode";
import { type OnshapeCredentials, basicAuth, onshapeConfig } from "./onshape-config";
import { drawingKey } from "./storage";

type ShopDb = ReturnType<typeof createShopDb>;

export async function drawingExistsInR2(
  env: AppEnv["Bindings"],
  teamId: string,
  partNumber: string,
  revision: string,
): Promise<boolean> {
  try {
    const obj = await env.DRAWINGS.head(drawingKey(teamId, partNumber, revision));
    return obj !== null;
  } catch {
    return false;
  }
}

export async function retrieveDrawingFromR2(
  env: AppEnv["Bindings"],
  teamId: string,
  partNumber: string,
  revision: string,
): Promise<ArrayBuffer> {
  const obj = await env.DRAWINGS.get(drawingKey(teamId, partNumber, revision));
  if (!obj) {
    throw new Error(`Drawing not found in R2: ${partNumber} revision ${revision}`);
  }
  return obj.arrayBuffer();
}

export async function storeDrawingInR2(
  env: AppEnv["Bindings"],
  teamId: string,
  partNumber: string,
  revision: string,
  pdfBuffer: ArrayBuffer,
): Promise<string> {
  const r2Key = drawingKey(teamId, partNumber, revision);

  // Stamp the part-number barcode before the drawing is stored, so every copy served or
  // printed from R2 carries it. A stamping failure must not cost us the drawing itself.
  let body: ArrayBuffer | Uint8Array = pdfBuffer;
  try {
    body = await stampBarcode(pdfBuffer, drawingBarcodeValue(partNumber, revision));
  } catch (err) {
    console.error("[OnShape Export] Barcode stamp failed, storing unstamped drawing", {
      partNumber,
      revision,
      error: err instanceof Error ? err.message : err,
    });
  }

  await env.DRAWINGS.put(r2Key, body, {
    httpMetadata: {
      contentType: "application/pdf",
    },
  });
  console.log("[OnShape Export] Stored drawing in R2", {
    partNumber,
    revision,
    r2Key,
    size: body.byteLength,
    stamped: body !== pdfBuffer,
  });
  return r2Key;
}

export async function getDrawingExportParams(
  env: AppEnv["Bindings"],
  db: ShopDb,
  teamId: string,
  partNumber: string,
): Promise<{
  documentId: string;
  versionId: string;
  drawingEntityId: string;
  credentials: OnshapeCredentials;
}> {
  const config = await onshapeConfig(env, db, teamId);
  const documentId = config.documentId;
  if (!documentId) {
    throw new Error("Document ID not configured in database");
  }
  if (!config.credentials) {
    throw new Error("OnShape API credentials not configured");
  }

  // Get part info from database (most recent)
  const part = await db
    .select()
    .from(schema.onshapeParts)
    .where(inTeam(schema.onshapeParts, teamId, eq(schema.onshapeParts.partNumber, partNumber)))
    .orderBy(desc(schema.onshapeParts.createdAt))
    .get();

  if (!part) {
    throw new Error(`Part not found: ${partNumber}`);
  }

  if (!part.partDrawingEntityId) {
    throw new Error(`Part drawing entity ID not available for: ${partNumber}`);
  }

  if (!part.versionId) {
    throw new Error(`Part version ID not available for: ${partNumber}`);
  }

  return {
    documentId,
    versionId: part.versionId,
    drawingEntityId: part.partDrawingEntityId,
    credentials: config.credentials,
  };
}

export async function exportDrawingAsPDF(
  documentId: string,
  versionId: string,
  drawingEntityId: string,
  onshape: OnshapeCredentials,
): Promise<ArrayBuffer> {
  const credentials = basicAuth(onshape);

  // Step 1: Request PDF export
  console.log("[OnShape Export] Requesting PDF export", { documentId, versionId, drawingEntityId });

  const exportResponse = await fetch(
    `https://cad.onshape.com/api/v16/drawings/d/${documentId}/v/${versionId}/e/${drawingEntityId}/translations`,
    {
      method: "POST",
      headers: {
        Authorization: credentials,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        formatName: "PDF",
        storeInDocument: false,
      }),
    },
  );

  if (!exportResponse.ok) {
    const error = await exportResponse.text();
    console.error("[OnShape Export] Failed to request export", error);
    throw new Error(`Failed to request PDF export: ${exportResponse.status}`);
  }

  const exportData = (await exportResponse.json()) as {
    id: string;
    requestState: string;
    resultExternalDataIds?: string[];
  };

  const translationId = exportData.id;
  console.log("[OnShape Export] Export requested", { translationId });

  // Step 2: Wait before first poll (export needs time to process)
  console.log("[OnShape Export] Waiting 15 seconds before polling...");
  await new Promise((resolve) => setTimeout(resolve, 15000));

  let translationStatus: {
    id: string;
    requestState: string;
    resultExternalDataIds?: string[];
    failureReason?: string;
  } = { ...exportData, failureReason: undefined };
  let retries = 0;
  const maxRetries = 1;

  while (translationStatus.requestState !== "DONE" && retries <= maxRetries) {
    if (retries > 0) {
      console.log("[OnShape Export] Waiting 15 seconds before retry...");
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }

    console.log("[OnShape Export] Polling status", { translationId, attempt: retries + 1 });

    const statusResponse = await fetch(
      `https://cad.onshape.com/api/v16/translations/${translationId}`,
      {
        headers: {
          Authorization: credentials,
        },
      },
    );

    if (!statusResponse.ok) {
      const error = await statusResponse.text();
      console.error("[OnShape Export] Failed to get status", error);
      throw new Error(`Failed to get export status: ${statusResponse.status}`);
    }

    translationStatus = (await statusResponse.json()) as {
      id: string;
      requestState: string;
      resultExternalDataIds?: string[];
      failureReason?: string;
    };

    retries++;
  }

  if (translationStatus.requestState !== "DONE") {
    const failureReason = translationStatus.failureReason || "Unknown error";
    console.error("[OnShape Export] Export failed or timed out", failureReason);
    throw new Error(`PDF export failed: ${failureReason}`);
  }

  if (
    !translationStatus.resultExternalDataIds ||
    translationStatus.resultExternalDataIds.length === 0
  ) {
    console.error("[OnShape Export] No external data IDs in response");
    throw new Error("No PDF data returned from export");
  }

  const externalDataId = translationStatus.resultExternalDataIds[0];
  console.log("[OnShape Export] Export complete, downloading PDF", { externalDataId });

  // Step 3: Download the PDF
  const downloadResponse = await fetch(
    `https://cad.onshape.com/api/v16/documents/d/${documentId}/externaldata/${externalDataId}`,
    {
      headers: {
        Authorization: credentials,
      },
    },
  );

  if (!downloadResponse.ok) {
    const error = await downloadResponse.text();
    console.error("[OnShape Export] Failed to download PDF", error);
    throw new Error(`Failed to download PDF: ${downloadResponse.status}`);
  }

  const pdfBuffer = await downloadResponse.arrayBuffer();
  console.log("[OnShape Export] PDF downloaded successfully", { size: pdfBuffer.byteLength });

  return pdfBuffer;
}
