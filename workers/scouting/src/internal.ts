import { deleteTeamRows, exportTeamRows, teamExport } from "@g3/auth";
import { Hono } from "hono";
import { createDb } from "./db";
import { seedTeam, teamTables } from "./db/bootstrap";
import { manifest } from "./manifest";
import type { AppEnv } from "./types";

/** Service-binding hooks; the gateway rejects /api/internal before forwarding. */
export const internalRoutes = new Hono<AppEnv>()
  .post("/teams/:teamId/seed", async (c) => {
    await seedTeam(createDb(c.env.SCOUTING_DB), c.req.param("teamId"));
    return c.json({ ok: true });
  })
  .get("/teams/:teamId/export", async (c) => {
    const teamId = c.req.param("teamId");
    const tables = await exportTeamRows(createDb(c.env.SCOUTING_DB), teamId, teamTables, {
      strategy_event_config: ["tba_auth_key", "nexus_api_key"],
    });
    return c.json(
      teamExport(manifest, teamId, tables, [
        "API keys are omitted. Uploaded images and drawings are stored separately; this export includes their references, not the file contents.",
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
    return c.json({ ok: true });
  });
