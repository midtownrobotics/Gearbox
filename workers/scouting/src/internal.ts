// SPDX-License-Identifier: AGPL-3.0-only
import {
  clearTeamStorageLock,
  deleteTeamRows,
  downloadStorageFile,
  exportTeamRows,
  storageArchive,
  storageArchiveSelection,
  storageByTeam,
  teamExport,
} from "@g3/auth";
import { isDemoTeam } from "@g3/demo";
import { Hono } from "hono";
import { createDb } from "./db";
import { seedTeam, teamTables } from "./db/bootstrap";
import { seasonExportParts, seasonExports } from "./db/schema";
import { demoWords, loadDemo } from "./demo";
import { downloadableDrawing, drawingArchiveAssets } from "./drawing-storage";
import { manifest } from "./manifest";
import { seasonExportRoutes } from "./season-exports";
import { scoutingStorageReport } from "./storage-report";
import type { AppEnv } from "./types";

/** Service-binding hooks; the gateway rejects /api/internal before forwarding. */
export const internalRoutes = new Hono<AppEnv>()
  .route("/teams/:teamId/seasons", seasonExportRoutes)
  // The public demo (roadmap Phase 5): its sample data, after the nightly reset deleted the
  // team's, and the words in it, which the gateway lets demo visitors send.
  .post("/teams/:teamId/demo", async (c) => {
    const teamId = c.req.param("teamId");
    if (!isDemoTeam(teamId)) return c.json({ error: "Only the demo team." }, 403);
    return c.json(await loadDemo(createDb(c.env.SCOUTING_DB), teamId));
  })
  .get("/demo/words", (c) => c.json({ words: demoWords() }))
  // How much every team keeps in R2 (files under teams/<encoded team>/; files from before teams
  // were kept apart aren't counted), for the operators' console. Counts only.
  .get("/storage", async (c) =>
    c.json({ teams: await storageByTeam(c.env.FIELD_MAPS, "teams/", {}, true) }),
  )
  .post("/teams/:teamId/seed", async (c) => {
    await seedTeam(createDb(c.env.SCOUTING_DB), c.req.param("teamId"));
    return c.json({ ok: true });
  })
  .get("/teams/:teamId/storage", async (c) =>
    c.json(await scoutingStorageReport(c.env, c.req.param("teamId"))),
  )
  .get("/teams/:teamId/storage/archive", async (c) => {
    const report = await scoutingStorageReport(c.env, c.req.param("teamId"));
    const files = report.allowances[0].files.filter(
      (f) => c.req.query("eligible") !== "1" || f.eligible,
    );
    return storageArchive(
      c.env.FIELD_MAPS,
      storageArchiveSelection(files, c.req.query("from"), c.req.query("to")),
      "scouting-files",
      drawingArchiveAssets,
    );
  })
  .get("/teams/:teamId/storage/download", (c) =>
    downloadStorageFile(
      c.env.FIELD_MAPS,
      `teams/${encodeURIComponent(c.req.param("teamId"))}/`,
      c.req.query("key") ?? "",
      downloadableDrawing,
    ),
  )
  .get("/teams/:teamId/export", async (c) => {
    const teamId = c.req.param("teamId");
    const tables = await exportTeamRows(
      createDb(c.env.SCOUTING_DB),
      teamId,
      teamTables.filter((table) => table !== seasonExports && table !== seasonExportParts),
      {
        strategy_event_config: ["tba_auth_key", "nexus_api_key"],
      },
    );
    return c.json(
      teamExport(manifest, teamId, tables, [
        "API keys are omitted. Uploaded images and coordinate drawings are stored separately; this export includes their references, not the file contents.",
      ]),
    );
  })
  .delete("/teams/:teamId", async (c) => {
    const teamId = c.req.param("teamId");
    const db = createDb(c.env.SCOUTING_DB);
    // Read owned rows first so pre-tenancy objects retain their existing addresses safely.
    const rows = await exportTeamRows(db, teamId, teamTables);
    const keys = new Set<string>();
    for (const values of Object.values(rows))
      for (const row of values) {
        for (const column of ["r2_key", "image_r2_key", "drawing_r2_key"]) {
          if (typeof row[column] === "string") keys.add(row[column]);
        }
        if (typeof row.drawing_fields_json === "string") {
          const drawings = JSON.parse(row.drawing_fields_json) as Record<string, { key?: string }>;
          for (const drawing of Object.values(drawings)) if (drawing.key) keys.add(drawing.key);
        }
      }
    // Also remove interrupted uploads that never acquired a database row.
    let cursor: string | undefined;
    do {
      const objects = await c.env.FIELD_MAPS.list({
        prefix: `teams/${encodeURIComponent(teamId)}/`,
        cursor,
      });
      for (const object of objects.objects) keys.add(object.key);
      cursor = objects.truncated ? objects.cursor : undefined;
    } while (cursor);
    const files = Array.from(keys);
    for (let offset = 0; offset < files.length; offset += 1000) {
      await c.env.FIELD_MAPS.delete(files.slice(offset, offset + 1000));
    }
    await deleteTeamRows(db, teamId, teamTables);
    await clearTeamStorageLock(c.env.SCOUTING_DB, teamId);
    return c.json({ ok: true });
  });
