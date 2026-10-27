import { inTeam, sendTeamMessage, withTeam } from "@g3/auth";
import { eq } from "drizzle-orm";
import { createShopDb } from "../db";
import * as schema from "../db/schema";
import type { AppEnv } from "../types";
import { onshapeConfig } from "./onshape-config";
import { followedDocument } from "./onshape-documents";
import { exportDrawingAsPDF, storeDrawingInR2 } from "./onshape-export";
import {
  ELEMENT_DRAWING,
  ELEMENT_PART_STUDIO,
  type ReleaseDetails,
  type ReleaseItem,
  fetchReleasePackage,
} from "./onshape-release";
import { fetchAndParseBOM } from "./onshape-webhook";
import { SETTING, getSetting } from "./settings";
import { shopUrl } from "./urls";

/**
 * One team's approved Onshape release, to read the release package, BOM quantities and drawings for
 * (lib/onshape-webhook.ts).
 */
export interface BOMQueueMessage {
  teamId: string;
  releaseId: string;
  releaseRowId: number;
  timestamp: string;
}

type ShopDb = ReturnType<typeof createShopDb>;

/**
 * Keeps what the release package says: the release's details on its row, and each part and
 * drawing in it as a part of the release (as the revision events record them; drawings share
 * their part's number). Parts go before drawings, so a part's name is the part's, not its drawing's.
 */
async function saveRelease(
  db: ShopDb,
  teamId: string,
  releaseId: string,
  releaseRowId: number,
  release: { details: ReleaseDetails; items: ReleaseItem[] },
) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.onshapeReleases)
    .set({ ...release.details, detailsAt: now })
    .where(inTeam(schema.onshapeReleases, teamId, eq(schema.onshapeReleases.id, releaseRowId)));

  const items = [...release.items].sort(
    (a, b) => Number(a.elementType === ELEMENT_DRAWING) - Number(b.elementType === ELEMENT_DRAWING),
  );
  for (const item of items) {
    const drawing = item.elementType === ELEMENT_DRAWING;
    const set = {
      releaseId: releaseRowId,
      versionId: item.versionId,
      ...(item.elementType === ELEMENT_PART_STUDIO && { entityId: item.elementId }),
      ...(drawing && { partDrawingEntityId: item.elementId }),
      ...(!drawing && item.name && { name: item.name }),
      ...(!drawing && item.description && { description: item.description }),
      ...(item.revision && { revision: item.revision }),
    };
    await db
      .insert(schema.onshapeParts)
      .values(
        withTeam(teamId, {
          onshapeReleaseId: releaseId,
          partNumber: item.partNumber,
          ...set,
          createdAt: now,
        }),
      )
      .onConflictDoUpdate({
        target: [
          schema.onshapeParts.teamId,
          schema.onshapeParts.onshapeReleaseId,
          schema.onshapeParts.partNumber,
        ],
        set,
      });
  }
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

  // The team's keys.
  const config = await onshapeConfig(env, database, teamId);
  const { credentials } = config;
  if (!credentials) {
    console.log("[BOM Queue Job] No Onshape keys for this team, skipping");
    return;
  }
  const api = { db: database, teamId, credentials };

  // The release package: its name, who made and approved it, and its parts and drawings. If it
  // can't be read, the parts the revision events recorded are used, with the BOM's details.
  console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Fetching release package`);
  const release = await fetchReleasePackage(releaseId, api);
  if (release) await saveRelease(database, teamId, releaseId, releaseRowId, release);

  const parts = await database
    .select()
    .from(schema.onshapeParts)
    .where(inTeam(schema.onshapeParts, teamId, eq(schema.onshapeParts.releaseId, releaseRowId)));

  console.log(`[BOM Queue Job] Found ${parts.length} parts`);

  if (parts.length === 0) {
    console.log("[BOM Queue Job] No parts found, skipping");
    return;
  }

  // The document it came from (the package's, else the webhook's), and that document's project
  // and main assembly while the team follows it.
  const row = await database
    .select({ documentId: schema.onshapeReleases.documentId })
    .from(schema.onshapeReleases)
    .where(inTeam(schema.onshapeReleases, teamId, eq(schema.onshapeReleases.id, releaseRowId)))
    .get();
  const documentId = release?.details.documentId ?? row?.documentId ?? null;
  const document = documentId ? await followedDocument(database, teamId, documentId) : undefined;
  if (document) {
    await database
      .update(schema.onshapeReleases)
      .set({ documentId, projectId: document.projectId })
      .where(inTeam(schema.onshapeReleases, teamId, eq(schema.onshapeReleases.id, releaseRowId)));
  }
  const mainAssemblyId = document?.mainAssemblyId ?? null;
  const project = document
    ? await database
        .select({ name: schema.projects.name })
        .from(schema.projects)
        .where(inTeam(schema.projects, teamId, eq(schema.projects.id, document.projectId)))
        .get()
    : undefined;
  const versionId = release?.details.versionId ?? parts[0]?.versionId ?? null;
  const docId = documentId || "unknown";

  // Quantities come from the main assembly's BOM, when the team has set one. Without the release
  // package, so do the names, descriptions and revisions.
  if (documentId && mainAssemblyId && versionId) {
    console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Fetching BOM data`);
    const bomMetadata = await fetchAndParseBOM(documentId, versionId, mainAssemblyId, api);
    for (const part of parts) {
      const metadata = bomMetadata.get(part.partNumber);
      if (!metadata) continue;
      await database
        .update(schema.onshapeParts)
        .set(
          release
            ? { quantity: metadata.quantity ?? part.quantity }
            : {
                quantity: metadata.quantity ?? part.quantity,
                name: metadata.name ?? part.name,
                description: metadata.description ?? part.description,
                revision: metadata.revision ?? part.revision,
              },
        )
        .where(inTeam(schema.onshapeParts, teamId, eq(schema.onshapeParts.id, part.id)));
    }
  }

  const updatedParts = await database
    .select()
    .from(schema.onshapeParts)
    .where(inTeam(schema.onshapeParts, teamId, eq(schema.onshapeParts.releaseId, releaseRowId)));

  // The message, in Gearbox's chat format (`sendTeamMessage`: Slack or Discord).
  console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Building the release message`);
  const shop = shopUrl(env, teamId);
  const details = release?.details;
  const releaseLink = `[${details?.name ?? releaseId}](https://cad.onshape.com/documents?releasepackage=${releaseId})`;
  const approvedBy = details?.approvers.filter((a) => a.approvedAt).map((a) => a.name) ?? [];
  const message = [
    "🎉 **New release candidate approved!**",
    `Release: ${releaseLink}`,
    ...(project ? [`Project: ${project.name}`] : []),
    ...(details?.madeBy ? [`Made by: ${details.madeBy}`] : []),
    ...(approvedBy.length > 0 ? [`Approved by: ${approvedBy.join(", ")}`] : []),
    ...(details?.notes && details.notes !== details.name ? [`Notes: ${details.notes}`] : []),
    `Time: <t:${Math.floor(new Date(timestamp).getTime() / 1000)}:f>`,
    `Parts: ${updatedParts.length}`,
    ...updatedParts.map((part) => {
      const onshape = (entity: string) =>
        `https://cad.onshape.com/documents/${docId}/v/${part.versionId}/e/${entity}`;
      const links = [
        `[Shop](${shop}/part?p=${part.partNumber})`,
        ...(part.entityId ? [`[Onshape part](${onshape(part.entityId)})`] : []),
        ...(part.partDrawingEntityId
          ? [`[Onshape drawing](${onshape(part.partDrawingEntityId)})`]
          : []),
      ];
      return [
        `• **${part.partNumber}**${part.name ? ` - "${part.name}"` : ""}${part.quantity ? ` (x${part.quantity})` : ""}`,
        ...(part.revision ? [`  Revision: ${part.revision}`] : []),
        `  ${links.join(" · ")}`,
      ].join("\n");
    }),
    "",
    `[Assign production processes](${shop}/ingest)`,
  ].join("\n");

  // On the team's own chat, in the channel its admins picked (none picked: no message).
  const channel = await getSetting(database, teamId, SETTING.releaseChannel);
  if (channel) {
    console.log(`[BOM Queue Job] [${Date.now() - jobStartTime}ms] Sending the release message`);
    const sent = await sendTeamMessage(env, teamId, channel, message);
    if (!sent.ok) console.error("[BOM Queue Job] Release message not sent:", sent.error);
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
              api,
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
            console.error(`[BOM Queue Job] Failed to export drawing for ${part.partNumber}`, err);
          }
        }),
      );
    }
    console.log(
      `[BOM Queue Job] [${Date.now() - jobStartTime}ms] Drawing export complete, exported ${drawingsExported} drawings`,
    );
  }

  const totalTime = Date.now() - jobStartTime;
  console.log("[BOM Queue Job] Complete", {
    releaseId,
    partCount: parts.length,
    totalTimeMs: totalTime,
  });
}
