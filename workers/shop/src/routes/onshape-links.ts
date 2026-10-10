import { inTeam, requireAuth } from "@g3/auth";
import { desc } from "drizzle-orm";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { onshapeParts } from "../db/schema";
import { SETTING, getSetting } from "../lib/settings";
import type { AppEnv } from "../types";

/**
 * Where the team's released parts live in Onshape. Nothing is stored: a release only leaves the
 * document, version and element ids behind (lib/onshape-webhook.ts), so the addresses are built
 * from those and the team's own document.
 */
export const onshapeLinksRouter = new Hono<AppEnv>().get("/links", requireAuth, async (c) => {
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
      release: `https://cad.onshape.com/documents?releasepackage=${encodeURIComponent(row.releaseId)}`,
    });
  }
  return c.json({ links });
});
