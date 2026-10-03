import { appUrl } from "@g3/site-config";
import { sendMessage } from "@g3/slack";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv } from "../types";
import { exportDrawingAsPDF, storeDrawingInR2 } from "./onshape-export";
import { fetchAndParseBOM } from "./onshape-webhook";

const DEFAULT_SLACK_CHANNEL_ID = "C09QYMTSGKT";

export interface BOMQueueMessage {
  releaseId: string;
  releaseRowId: number;
  timestamp: string;
}

export async function processBOMQueue(
  jobData: BOMQueueMessage,
  env: AppEnv["Bindings"],
): Promise<void> {
  await processSingleBOMJob(jobData, env);
}

async function processSingleBOMJob(
  jobData: BOMQueueMessage,
  env: AppEnv["Bindings"],
): Promise<void> {
  const jobStartTime = Date.now();
  const { releaseId, releaseRowId, timestamp } = jobData;

  console.log(`[BOM Queue Job] Starting for release ${releaseId}`);

  const database = drizzle(env.SHOP_DB, { schema });

  // Query parts for this release
  console.log("[BOM Queue Job] Querying parts for release");
  const parts = await database
    .select()
    .from(schema.onshapeParts)
    .where(eq(schema.onshapeParts.releaseId, releaseRowId));

  console.log(`[BOM Queue Job] Found ${parts.length} parts`);

  if (parts.length === 0) {
    console.log("[BOM Queue Job] No parts found, skipping BOM fetch");
    return;
  }

  // Get document ID and main assembly ID from database
  const docIdSetting = await database
    .select()
    .from(schema.adminSettings)
    .where(eq(schema.adminSettings.key, "onshape_document_id"))
    .get();
  const mainAssemblyIdSetting = await database
    .select()
    .from(schema.adminSettings)
    .where(eq(schema.adminSettings.key, "onshape_main_assembly_id"))
    .get();
  const documentId = docIdSetting?.value;
  const mainAssemblyId = mainAssemblyIdSetting?.value;
  const docId = documentId || "unknown";

  // Fetch BOM data if we have the necessary IDs
  if (documentId && mainAssemblyId && parts[0]?.versionId) {
    const apiKey = env.ONSHAPE_API_KEY;
    const apiSecret = env.ONSHAPE_API_SECRET;

    if (apiKey && apiSecret) {
      console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Fetching BOM data`);
      const bomMetadata = await fetchAndParseBOM(
        documentId,
        parts[0].versionId,
        mainAssemblyId,
        apiKey,
        apiSecret,
      );
      console.log(
        `[BOM Queue Job] [${Date.now() - jobStartTime}ms] BOM fetch complete, updating ${parts.length} parts`,
      );

      // Update parts with BOM metadata
      for (const part of parts) {
        const metadata = bomMetadata.get(part.partNumber);
        if (metadata) {
          await database
            .update(schema.onshapeParts)
            .set({
              quantity: metadata.quantity ?? part.quantity,
              name: metadata.name ?? part.name,
              description: metadata.description ?? part.description,
              revision: metadata.revision ?? part.revision,
            })
            .where(eq(schema.onshapeParts.id, part.id));
        }
      }

      // Refetch parts to get updated metadata
      console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Refetching updated parts`);
      const updatedParts = await database
        .select()
        .from(schema.onshapeParts)
        .where(eq(schema.onshapeParts.releaseId, releaseRowId));

      // Build and send Slack message with BOM data
      console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Building Slack message`);
      const releaseLink = `<https://cad.onshape.com/documents?releasepackage=${releaseId}|${releaseId}>`;
      const message = [
        "🎉 *New release candidate approved!*",
        `Release: ${releaseLink}`,
        `Time: <!date^${Math.floor(new Date(timestamp).getTime() / 1000)}^{date_num} {time_secs}|${timestamp}>`,
        `Parts: ${updatedParts.length}`,
        ...updatedParts.map((part) => {
          const partLink = part.entityId
            ? `\n    • <https://cad.onshape.com/documents/${docId}/v/${part.versionId}/e/${part.entityId}|OnShape Part Link>`
            : "";
          const drawingLink = part.partDrawingEntityId
            ? `\n    • <https://cad.onshape.com/documents/${docId}/v/${part.versionId}/e/${part.partDrawingEntityId}|OnShape Drawing Link>`
            : "";
          return `
  • *${part.partNumber}*${part.name ? ` - "${part.name}"` : ""}${part.quantity ? ` (x${part.quantity})` : ""}
    ${part.revision ? `• Revision: ${part.revision}` : ""}
    • <${appUrl("shop")}/part?p=${part.partNumber}|Shop SW Link>${partLink}${drawingLink}
          `;
        }),
        `\nClick <${appUrl("shop")}/ingest|here> to assign production processes.`,
      ].join("\n");

      console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Sending Slack message`);
      const channelIdSetting = await database
        .select()
        .from(schema.adminSettings)
        .where(eq(schema.adminSettings.key, "slack_release_channel_id"))
        .get();
      const slackChannelId = channelIdSetting?.value || DEFAULT_SLACK_CHANNEL_ID;
      await sendMessage(slackChannelId, message, env);

      // Export drawings for parts that have both drawing entity ID and revision (batched 4 at a time)
      if (documentId) {
        console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Exporting drawings`);
        const partsToExport = updatedParts.filter(
          (p) => p.partDrawingEntityId && p.revision && p.versionId,
        );

        let drawingsExported = 0;
        for (let i = 0; i < partsToExport.length; i += 4) {
          const batch = partsToExport.slice(i, i + 4);
          await Promise.all(
            batch.map(async (part) => {
              try {
                const pdfBuffer = await exportDrawingAsPDF(
                  documentId,
                  part.versionId as string,
                  part.partDrawingEntityId as string,
                  env,
                );

                await storeDrawingInR2(part.partNumber, part.revision as string, pdfBuffer, env);
                drawingsExported++;
              } catch (err) {
                console.error(
                  `[BOM Queue Job] Failed to export drawing for ${part.partNumber}`,
                  err,
                );
              }
            }),
          );
        }
        console.log(
          `[BOM Queue Job] [${Date.now() - jobStartTime}ms] Drawing export complete, exported ${drawingsExported} drawings`,
        );
      }
    }
  }

  const totalTime = Date.now() - jobStartTime;
  console.log("[BOM Queue Job] Complete", {
    releaseId,
    partCount: parts.length,
    totalTimeMs: totalTime,
  });
}
