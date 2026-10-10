import { inTeam, sendTeamMessage } from "@g3/auth";
import { eq } from "drizzle-orm";
import { createShopDb } from "../db";
import * as schema from "../db/schema";
import type { AppEnv } from "../types";
import { onshapeConfig } from "./onshape-config";
import { exportDrawingAsPDF, storeDrawingInR2 } from "./onshape-export";
import { fetchAndParseBOM } from "./onshape-webhook";
import { SETTING, getSetting } from "./settings";
import { shopUrl } from "./urls";

/** One team's approved Onshape release, to fetch the BOM and drawings for (lib/onshape-webhook.ts). */
export interface BOMQueueMessage {
  teamId: string;
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
  const { teamId, releaseId, releaseRowId, timestamp } = jobData;
  // Queued before releases carried their team: there's no telling whose it is.
  if (!teamId) {
    console.warn("[BOM Queue Job] Skipping a release queued without its team", { releaseId });
    return;
  }

  console.log(`[BOM Queue Job] Starting for release ${releaseId}`, { teamId });

  const database = createShopDb(env.SHOP_DB);

  // Query parts for this release
  console.log("[BOM Queue Job] Querying parts for release");
  const parts = await database
    .select()
    .from(schema.onshapeParts)
    .where(inTeam(schema.onshapeParts, teamId, eq(schema.onshapeParts.releaseId, releaseRowId)));

  console.log(`[BOM Queue Job] Found ${parts.length} parts`);

  if (parts.length === 0) {
    console.log("[BOM Queue Job] No parts found, skipping BOM fetch");
    return;
  }

  // The team's document and keys.
  const config = await onshapeConfig(env, database, teamId);
  const { documentId, mainAssemblyId, credentials } = config;
  const docId = documentId || "unknown";

  // Fetch BOM data if we have the necessary IDs
  if (documentId && mainAssemblyId && parts[0]?.versionId) {
    if (credentials) {
      console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Fetching BOM data`);
      const bomMetadata = await fetchAndParseBOM(
        documentId,
        parts[0].versionId,
        mainAssemblyId,
        credentials,
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
            .where(inTeam(schema.onshapeParts, teamId, eq(schema.onshapeParts.id, part.id)));
        }
      }

      // Refetch parts to get updated metadata
      console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Refetching updated parts`);
      const updatedParts = await database
        .select()
        .from(schema.onshapeParts)
        .where(
          inTeam(schema.onshapeParts, teamId, eq(schema.onshapeParts.releaseId, releaseRowId)),
        );

      // Build and send Slack message with BOM data
      console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Building Slack message`);
      const shop = shopUrl(env, teamId);
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
    • <${shop}/part?p=${part.partNumber}|Shop SW Link>${partLink}${drawingLink}
          `;
        }),
        `\nClick <${shop}/ingest|here> to assign production processes.`,
      ].join("\n");

      // On the team's own Slack, in the channel its admins picked (none picked: no message).
      const channel = await getSetting(database, teamId, SETTING.slackReleaseChannel);
      if (channel) {
        console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Sending Slack message`);
        const sent = await sendTeamMessage(env, teamId, channel, message);
        if (!sent.ok) console.error("[BOM Queue Job] Slack message not sent:", sent.error);
      }

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
                  credentials,
                );

                await storeDrawingInR2(
                  env,
                  teamId,
                  part.partNumber,
                  part.revision as string,
                  pdfBuffer,
                );
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
