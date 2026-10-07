import { deleteTeamRows } from "@g3/auth";
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
import { teamPrefix } from "../lib/storage";
import { shopUrl } from "../lib/urls";
import type { AppEnv } from "../types";

/**
 * For other workers only: the gateway never answers /internal. When an operator deletes a team
 * (the platform's console), its data here goes too: its Onshape webhook (if Onshape still lets
 * us), its files in R2 and every row.
 */
export const internalRouter = new Hono<AppEnv>().delete("/teams/:teamId", async (c) => {
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
