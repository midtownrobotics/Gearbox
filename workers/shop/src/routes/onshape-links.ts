import { inTeam, requireAuth } from "@g3/auth";
import { desc } from "drizzle-orm";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { onshapeParts, onshapeReleases } from "../db/schema";
import { SETTING, getSetting } from "../lib/settings";
import type { AppEnv } from "../types";

// Where the team's released parts live in Onshape. No addresses are stored: a release leaves the
// document, version and element ids behind (lib/onshape-webhook.ts, lib/bom-queue-consumer.ts), so
// the addresses are built from those, or from the team's own document for older releases.

const ONSHAPE = "https://cad.onshape.com/documents";

const releasePackageUrl = (releaseId: string) =>
  `${ONSHAPE}?releasepackage=${encodeURIComponent(releaseId)}`;

export const onshapeLinksRouter = new Hono<AppEnv>()
  /**
   * The team's Onshape releases, newest first, each with what the release package said about it
   * (lib/onshape-release.ts; null for releases from before that was kept), its parts, and links to
   * the document, each part and each drawing as they were at that release.
   */
  .get("/releases", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const [teamDocument, releases, parts] = await Promise.all([
      getSetting(db, teamId, SETTING.onshapeDocument),
      db
        .select()
        .from(onshapeReleases)
        .where(inTeam(onshapeReleases, teamId))
        .orderBy(desc(onshapeReleases.timestamp), desc(onshapeReleases.id))
        .all(),
      db
        .select()
        .from(onshapeParts)
        .where(inTeam(onshapeParts, teamId))
        .orderBy(onshapeParts.partNumber)
        .all(),
    ]);

    const byRelease = new Map<number, typeof parts>();
    for (const part of parts) {
      if (part.releaseId === null) continue;
      byRelease.set(part.releaseId, [...(byRelease.get(part.releaseId) ?? []), part]);
    }

    return c.json({
      releases: releases.map((release) => {
        const own = byRelease.get(release.id) ?? [];
        const documentId = release.documentId ?? teamDocument;
        const versionId = release.versionId ?? own.find((p) => p.versionId)?.versionId ?? null;
        const at = (version: string | null, element: string | null) =>
          documentId && version && element
            ? `${ONSHAPE}/${documentId}/v/${version}/e/${element}`
            : null;
        return {
          id: release.id,
          releaseId: release.releaseId,
          name: release.name,
          notes: release.notes,
          state: release.state,
          madeBy: release.madeBy,
          madeAt: release.madeAt,
          releasedAt: release.timestamp,
          approvers: release.approvers ?? [],
          comments: release.comments ?? [],
          links: {
            release: releasePackageUrl(release.releaseId),
            document: documentId && versionId ? `${ONSHAPE}/${documentId}/v/${versionId}` : null,
          },
          parts: own.map((part) => ({
            id: part.id,
            partNumber: part.partNumber,
            name: part.name,
            description: part.description,
            revision: part.revision,
            quantity: part.quantity,
            links: {
              part: at(part.versionId ?? versionId, part.entityId),
              drawing: at(part.versionId ?? versionId, part.partDrawingEntityId),
            },
          })),
        };
      }),
    });
  })
  .get("/links", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const documentId = await getSetting(db, teamId, SETTING.onshapeDocument);

    const rows = await db
      .select({
        partNumber: onshapeParts.partNumber,
        revision: onshapeParts.revision,
        versionId: onshapeParts.versionId,
        entityId: onshapeParts.entityId,
        releaseId: onshapeParts.onshapeReleaseId,
      })
      .from(onshapeParts)
      .where(inTeam(onshapeParts, teamId))
      .orderBy(desc(onshapeParts.createdAt))
      .all();

    // Newest release first, and one entry per part number and revision: a part released again under
    // the same revision only needs its latest place, and the order lets a page fall back to the
    // newest release of a part number when it holds no entry for the revision it is making.
    const seen = new Set<string>();
    const links = [];
    for (const row of rows) {
      const key = `${row.partNumber}\u0000${row.revision ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        partNumber: row.partNumber,
        revision: row.revision,
        part:
          documentId && row.versionId && row.entityId
            ? `https://cad.onshape.com/documents/${documentId}/v/${row.versionId}/e/${row.entityId}`
            : null,
        release: releasePackageUrl(row.releaseId),
      });
    }
    return c.json({ links });
  });
