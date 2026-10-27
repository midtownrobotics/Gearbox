import { inTeam, requireAuth } from "@g3/auth";
import { isDemoTeam } from "@g3/site-config";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { onshapeParts, onshapeReleases } from "../db/schema";
import { teamDocuments } from "../lib/onshape-documents";
import type { AppEnv } from "../types";

// Where the team's released parts live in Onshape. No addresses are stored: a release leaves the
// document, version and element ids behind (lib/onshape-webhook.ts, lib/bom-queue-consumer.ts), so
// the addresses are built from those (migration 0025 gave older releases the team's one document).

const ONSHAPE = "https://cad.onshape.com/documents";

const releasePackageUrl = (releaseId: string) =>
  `${ONSHAPE}?releasepackage=${encodeURIComponent(releaseId)}`;

export const onshapeLinksRouter = new Hono<AppEnv>()
  /**
   * The team's Onshape releases, newest first, each with what the release package said about it
   * (lib/onshape-release.ts; null for releases from before that was kept), its project, its parts,
   * and links to the document, each part and each drawing as they were at that release. A part a
   * later release of the same project has replaced is `obsolete`.
   */
  .get("/releases", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const [releases, parts] = await Promise.all([
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

    // A part is obsolete once a later release of its project holds its part number at another
    // revision. Releases are newest first, so by the time one is reached `later` has every release
    // after it.
    const later = new Map<string, Set<string | null>>();
    const obsolete = new Set<number>();
    for (const release of releases) {
      const own = byRelease.get(release.id) ?? [];
      const key = (partNumber: string) => `${release.projectId ?? ""}\u0000${partNumber}`;
      for (const part of own) {
        const revisions = [...(later.get(key(part.partNumber)) ?? [])];
        if (revisions.some((r) => r === null || part.revision === null || r !== part.revision)) {
          obsolete.add(part.id);
        }
      }
      for (const part of own) {
        const k = key(part.partNumber);
        later.set(k, (later.get(k) ?? new Set()).add(part.revision));
      }
    }

    return c.json({
      releases: releases.map((release) => {
        const own = byRelease.get(release.id) ?? [];
        const { documentId } = release;
        const versionId = release.versionId ?? own.find((p) => p.versionId)?.versionId ?? null;
        const at = (version: string | null, element: string | null) =>
          documentId && version && element
            ? `${ONSHAPE}/${documentId}/v/${version}/e/${element}`
            : null;
        return {
          id: release.id,
          releaseId: release.releaseId,
          projectId: release.projectId,
          name: release.name,
          notes: release.notes,
          state: release.state,
          madeBy: release.madeBy,
          madeAt: release.madeAt,
          releasedAt: release.timestamp,
          approvers: release.approvers ?? [],
          comments: release.comments ?? [],
          links: {
            // The demo's sample releases were never in Onshape: a link would open it on nothing.
            release: isDemoTeam(teamId) ? null : releasePackageUrl(release.releaseId),
            document: documentId && versionId ? `${ONSHAPE}/${documentId}/v/${versionId}` : null,
          },
          parts: own.map((part) => ({
            id: part.id,
            partNumber: part.partNumber,
            name: part.name,
            description: part.description,
            revision: part.revision,
            quantity: part.quantity,
            obsolete: obsolete.has(part.id),
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
    // The demo's sample releases were never in Onshape, so their ids lead nowhere.
    if (isDemoTeam(teamId)) return c.json({ links: [] });

    // Each part in the document its release came from. One whose release hasn't arrived yet is
    // taken to be in the team's document when it follows only one.
    const documents = await teamDocuments(db, teamId);
    const onlyDocument = documents.length === 1 ? documents[0].documentId : null;
    const rows = await db
      .select({
        partNumber: onshapeParts.partNumber,
        revision: onshapeParts.revision,
        versionId: onshapeParts.versionId,
        entityId: onshapeParts.entityId,
        releaseId: onshapeParts.onshapeReleaseId,
        documentId: onshapeReleases.documentId,
      })
      .from(onshapeParts)
      .leftJoin(
        onshapeReleases,
        inTeam(onshapeReleases, teamId, eq(onshapeReleases.id, onshapeParts.releaseId)),
      )
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
      const documentId = row.documentId ?? onlyDocument;
      links.push({
        partNumber: row.partNumber,
        revision: row.revision,
        part:
          documentId && row.versionId && row.entityId
            ? `${ONSHAPE}/${documentId}/v/${row.versionId}/e/${row.entityId}`
            : null,
        releaseId: row.releaseId,
        release: releasePackageUrl(row.releaseId),
      });
    }
    return c.json({ links });
  });
