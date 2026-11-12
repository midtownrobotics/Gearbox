// SPDX-License-Identifier: AGPL-3.0-only
import { deleteTeamRows, exportTeamRows, moveTarget, moveTeamRows, teamExport } from "@g3/auth";
import { isDemoTeam } from "@g3/demo";
import { Hono } from "hono";
import { createEdgeDb } from "../db";
import {
  edgeAudit,
  edgeBoxes,
  edgeStatus,
  netBlocklistDomains,
  netBlocklists,
  netClients,
  netGrants,
  netSettings,
  netSiteUsage,
  netSiteUsageDaily,
  netUsage,
  netUsageHourly,
} from "../db/schema";
import { demoWords, loadDemo } from "../demo";
import { disconnectBox } from "../lib/agent";
import { manifest } from "../manifest";
import type { AppEnv } from "../types";

/** Every table with the team's rows: the box's key first, so the box can't sign in again. */
const TEAM_TABLES = [
  edgeBoxes,
  netBlocklistDomains,
  netGrants,
  netBlocklists,
  netUsage,
  netUsageHourly,
  netSiteUsage,
  netSiteUsageDaily,
  netClients,
  netSettings,
  edgeStatus,
  edgeAudit,
];

/**
 * For other workers only: the gateway never answers /internal. When an operator deletes a team
 * (the platform's console), or 90 days after the team switches Edge off (the platform's app
 * library), its box's key, link and data go too.
 */
export const internalRouter = new Hono<AppEnv>()
  // The public demo (roadmap Phase 5): its sample data, after the nightly reset deleted the
  // team's, and the words in it, which the gateway lets demo visitors send.
  .post("/teams/:teamId/demo", async (c) => {
    const teamId = c.req.param("teamId");
    if (!isDemoTeam(teamId)) return c.json({ error: "Only the demo team." }, 403);
    return c.json(await loadDemo(createEdgeDb(c.env.EDGE_DB), teamId));
  })
  .get("/demo/words", (c) => c.json({ words: demoWords() }))
  // The team's data, for its admins to download before switching Edge off (the platform's app
  // library). The box key's hash is left out.
  .get("/teams/:teamId/export", async (c) => {
    const teamId = c.req.param("teamId");
    const tables = await exportTeamRows(
      createEdgeDb(c.env.EDGE_DB),
      teamId,
      [
        edgeBoxes,
        edgeStatus,
        netSettings,
        netClients,
        netBlocklists,
        netBlocklistDomains,
        netGrants,
        netUsage,
        netUsageHourly,
        netSiteUsage,
        netSiteUsageDaily,
        edgeAudit,
      ],
      { edge_boxes: ["keyHash"] },
    );
    return c.json(
      teamExport(manifest, teamId, tables, [
        "The box key isn't included: make a new one on the Edge Box page.",
      ]),
    );
  })
  .delete("/teams/:teamId", async (c) => {
    const teamId = c.req.param("teamId");
    // Rows before the rows they point at; the key first, so the box can't sign in again.
    await deleteTeamRows(createEdgeDb(c.env.EDGE_DB), teamId, TEAM_TABLES);
    await disconnectBox(c.env, teamId).catch(() => undefined);
    return c.json({ ok: true });
  })
  // The team changed program, and so its id (the platform's team moves): its rows go with it, and
  // the box's link to the old id is dropped, so it connects again (its key is now the new id's).
  .post("/teams/:teamId/move", async (c) => {
    const from = c.req.param("teamId");
    const to = await moveTarget(c.req.raw, from);
    if (!to) return c.json({ error: "Say which team id to move to." }, 400);
    await moveTeamRows(createEdgeDb(c.env.EDGE_DB), from, to, TEAM_TABLES);
    await disconnectBox(c.env, from).catch(() => undefined);
    return c.json({ done: true });
  });
