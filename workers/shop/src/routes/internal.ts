import { deleteTeamRows, exportTeamRows, teamExport } from "@g3/auth";
import { Hono } from "hono";
import { createShopDb } from "../db";
import {
  actions,
  adminSettings,
  drawings,
  files,
  kioskPresence,
  onshapeParts,
  onshapeReleases,
  partDefinitionProcessBlueprints,
  partDefinitions,
  partInstanceFiles,
  partInstanceProcesses,
  partInstances,
  processes,
  stagingBatches,
  subsystems,
} from "../db/schema";
import { onshapeConfig } from "../lib/onshape-config";
import { unregisterOnShapeWebhooks } from "../lib/onshape-webhook";
import { SETTING } from "../lib/settings";
import { teamPrefix } from "../lib/storage";
import { shopUrl } from "../lib/urls";
import { manifest } from "../manifest";
import type { AppEnv } from "../types";

/**
 * For other workers only: the gateway never answers /internal. When an operator deletes a team
 * (the platform's console), or 90 days after the team switches Shop off (the platform's app
 * library), its data here goes too: its Onshape webhook (if Onshape still lets
 * us), its files in R2 and every row.
 */
/** Settings that are secrets (stored encrypted): never in an export. */
const SECRET_SETTINGS: string[] = [
  SETTING.onshapeApiKey,
  SETTING.onshapeApiSecret,
  SETTING.onshapeWebhookPrimary,
  SETTING.onshapeWebhookSecondary,
];

export const internalRouter = new Hono<AppEnv>()
  // The team's data, for its admins to download before switching Shop off (the platform's app
  // library): every row, and a list of its files in R2 (drawings, part files), which stay there
  // until the data is deleted. Onshape's keys are left out.
  .get("/teams/:teamId/export", async (c) => {
    const teamId = c.req.param("teamId");
    const db = createShopDb(c.env.SHOP_DB);
    const tables = await exportTeamRows(db, teamId, [
      adminSettings,
      subsystems,
      processes,
      partDefinitions,
      partDefinitionProcessBlueprints,
      partInstances,
      partInstanceProcesses,
      partInstanceFiles,
      stagingBatches,
      files,
      drawings,
      onshapeReleases,
      onshapeParts,
      kioskPresence,
      actions,
    ]);
    tables.admin_settings = (tables.admin_settings ?? []).filter(
      (row) => !SECRET_SETTINGS.includes(String(row.key)),
    );
    const stored: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    do {
      const page = await c.env.DRAWINGS.list({ prefix: teamPrefix(teamId), limit: 1000, cursor });
      for (const o of page.objects) stored.push({ key: o.key, size: o.size, uploaded: o.uploaded });
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    tables.stored_files = stored;
    return c.json(
      teamExport(manifest, teamId, tables, [
        "stored_files lists the drawings and part files; download them from Shop before they're deleted.",
        "Onshape's API and webhook keys aren't included: enter them again on Shop's Admin page.",
      ]),
    );
  })
  .delete("/teams/:teamId", async (c) => {
    const teamId = c.req.param("teamId");
    const db = createShopDb(c.env.SHOP_DB);

    // Best effort: an Onshape webhook left behind only calls an address that no longer answers.
    const onshape = await onshapeConfig(c.env, db, teamId).catch(() => null);
    if (onshape?.documentId && onshape.credentials) {
      await unregisterOnShapeWebhooks(
        onshape.documentId,
        onshape.credentials,
        `${shopUrl(c.env, teamId)}/api/onshape/events`,
      );
    }

    // R2 deletes up to 1,000 keys at a time; list and delete until nothing's left.
    const prefix = teamPrefix(teamId);
    for (;;) {
      const page = await c.env.DRAWINGS.list({ prefix, limit: 1000 });
      if (page.objects.length === 0) break;
      await c.env.DRAWINGS.delete(page.objects.map((o) => o.key));
    }

    // Rows before the rows they point at.
    await deleteTeamRows(db, teamId, [
      actions,
      partInstanceFiles,
      partInstanceProcesses,
      stagingBatches,
      files,
      partDefinitionProcessBlueprints,
      partInstances,
      partDefinitions,
      processes,
      subsystems,
      kioskPresence,
      onshapeParts,
      onshapeReleases,
      drawings,
      adminSettings,
    ]);
    return c.json({ ok: true });
  });
