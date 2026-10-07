import { deleteTeamRows } from "@g3/auth";
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
import { disconnectBox } from "../lib/agent";
import type { AppEnv } from "../types";

/**
 * For other workers only: the gateway never answers /internal. When an operator deletes a team
 * (the platform's console), its box's key, link and data go too.
 */
export const internalRouter = new Hono<AppEnv>().delete("/teams/:teamId", async (c) => {
  const teamId = c.req.param("teamId");
  // Rows before the rows they point at; the key first, so the box can't sign in again.
  await deleteTeamRows(createEdgeDb(c.env.EDGE_DB), teamId, [
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
  ]);
  await disconnectBox(c.env, teamId).catch(() => undefined);
  return c.json({ ok: true });
});
