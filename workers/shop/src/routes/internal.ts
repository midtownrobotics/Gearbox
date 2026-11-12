// SPDX-License-Identifier: AGPL-3.0-only
import {
  clearTeamStorageLock,
  deleteTeamRows,
  downloadStorageFile,
  exportTeamRows,
  moveR2Prefix,
  moveTarget,
  moveTeamRows,
  moveTeamStorageRows,
  storageArchive,
  storageArchiveSelection,
  storageByTeam,
  teamExport,
} from "@g3/auth";
import { isDemoTeam } from "@g3/demo";
import { Hono } from "hono";
import { createShopDb } from "../db";
import {
  actions,
  adminSettings,
  drawings,
  files,
  kioskPresence,
  onshapeApiErrors,
  onshapeApiUsage,
  onshapeParts,
  onshapeReleases,
  partDefinitionProcessBlueprints,
  partDefinitions,
  partInstanceProcesses,
  partInstances,
  processes,
  qualityCheckItems,
  qualityReports,
  shopManagers,
  stagingBatchRemovals,
  stagingBatches,
  subsystems,
} from "../db/schema";
import { demoWords, loadDemo } from "../demo";
import { onshapeConfig } from "../lib/onshape-config";
import { registerOnShapeWebhook, unregisterOnShapeWebhooks } from "../lib/onshape-webhook";
import { SETTING } from "../lib/settings";
import { teamPrefix } from "../lib/storage";
import { shopStorageReport } from "../lib/storage-report";
import { shopUrl } from "../lib/urls";
import { manifest } from "../manifest";
import type { AppEnv } from "../types";

/** Every table with the team's rows: children before the rows they point at. */
const TEAM_TABLES = [
  actions,
  stagingBatchRemovals,
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
  shopManagers,
  qualityReports,
  qualityCheckItems,
  // Last: deleting the team calls Onshape first, which is counted here too.
  onshapeApiUsage,
  onshapeApiErrors,
];

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
  // The public demo (roadmap Phase 5): its sample data, after the nightly reset deleted the
  // team's, and the words in it, which the gateway lets demo visitors send.
  .post("/teams/:teamId/demo", async (c) => {
    const teamId = c.req.param("teamId");
    if (!isDemoTeam(teamId)) return c.json({ error: "Only the demo team." }, 403);
    return c.json(await loadDemo(c.env, teamId));
  })
  .get("/demo/words", (c) => c.json({ words: demoWords() }))
  // How much every team keeps in R2 (drawings and part files, under teams/<team>/), for the
  // operators' console. Counts only.
  .get("/storage", async (c) => c.json({ teams: await storageByTeam(c.env.DRAWINGS, "teams/") }))
  // The team's data, for its admins to download before switching Shop off (the platform's app
  // library): every row, and a list of its files in R2 (drawings, part files), which stay there
  // until the data is deleted. Onshape's keys are left out.
  .get("/teams/:teamId/storage", async (c) =>
    c.json(await shopStorageReport(c.env, c.req.param("teamId"))),
  )
  .get("/teams/:teamId/storage/archive", async (c) => {
    const report = await shopStorageReport(c.env, c.req.param("teamId"));
    const files = report.allowances[0].files.filter(
      (f) => c.req.query("eligible") !== "1" || f.eligible,
    );
    return storageArchive(
      c.env.DRAWINGS,
      storageArchiveSelection(files, c.req.query("from"), c.req.query("to")),
      "shop-files",
    );
  })
  .get("/teams/:teamId/storage/download", (c) =>
    downloadStorageFile(
      c.env.DRAWINGS,
      `teams/${encodeURIComponent(c.req.param("teamId"))}/`,
      c.req.query("key") ?? "",
    ),
  )
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
      stagingBatches,
      stagingBatchRemovals,
      files,
      drawings,
      onshapeReleases,
      onshapeParts,
      kioskPresence,
      actions,
      shopManagers,
      qualityReports,
      qualityCheckItems,
      onshapeApiUsage,
      onshapeApiErrors,
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
        { db, teamId, credentials: onshape.credentials },
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

    await deleteTeamRows(db, teamId, TEAM_TABLES);
    await clearTeamStorageLock(c.env.SHOP_DB, teamId);
    return c.json({ ok: true });
  })
  // The team changed program, and so its id (the platform's team moves): its files in R2 move to
  // the new id's prefix a few hundred at a time (`done: false` until they're all there), then its
  // rows and the keys they keep, and its Onshape webhook is registered again at its new address.
  .post("/teams/:teamId/move", async (c) => {
    const from = c.req.param("teamId");
    const to = await moveTarget(c.req.raw, from);
    if (!to) return c.json({ error: "Say which team id to move to." }, 400);
    const db = createShopDb(c.env.SHOP_DB);
    if (!(await moveR2Prefix(c.env.DRAWINGS, teamPrefix(from), teamPrefix(to)))) {
      return c.json({ done: false });
    }
    await moveTeamRows(db, from, to, TEAM_TABLES, {
      columns: [drawings.r2Key, files.r2Key],
      from: teamPrefix(from),
      to: teamPrefix(to),
    });
    await moveTeamStorageRows(c.env.SHOP_DB, from, to);
    // Best effort, like saving the Onshape settings: the webhook keeps calling the old address,
    // which still reaches the team until another team signs up with its old id.
    const onshape = await onshapeConfig(c.env, db, to).catch(() => null);
    if (onshape?.documentId && onshape.credentials && onshape.companyId) {
      const api = { db, teamId: to, credentials: onshape.credentials };
      await unregisterOnShapeWebhooks(
        onshape.documentId,
        api,
        `${shopUrl(c.env, from)}/api/onshape/events`,
      );
      await registerOnShapeWebhook(
        onshape.documentId,
        api,
        onshape.companyId,
        `${shopUrl(c.env, to)}/api/onshape/events`,
      ).catch((err) => console.error("[OnShape] Webhook after a team move", err));
    }
    return c.json({ done: true });
  });
