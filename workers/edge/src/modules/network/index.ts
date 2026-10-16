import { createEdgeDb } from "../../db";
import { netSiteUsage, netUsage } from "../../db/schema";
import type { AppEnv } from "../../types";
import { teamTimeZone } from "./common";
import { rollupUsage } from "./rollup";
import { rollupSites } from "./sites";

export { networkAgentRouter, networkRouter } from "./routes";

/** The nightly rollup, team by team: each team's rows stay its own, its days its box's. */
export async function networkScheduled(env: AppEnv["Bindings"]) {
  const db = createEdgeDb(env.EDGE_DB);
  // tenancy: all teams (finding which teams have usage to roll up)
  const usageTeams = await db.selectDistinct({ teamId: netUsage.teamId }).from(netUsage).all();
  // tenancy: all teams (finding which teams have site usage to roll up)
  const siteTeams = await db
    .selectDistinct({ teamId: netSiteUsage.teamId })
    .from(netSiteUsage)
    .all();
  const teams = new Set([...usageTeams, ...siteTeams].map((t) => t.teamId));
  for (const teamId of teams) {
    try {
      await rollupUsage(db, teamId);
      await rollupSites(db, teamId, await teamTimeZone(db, teamId));
    } catch (err) {
      // One team's failure doesn't stop the others'.
      console.error("[Rollup] Failed for team", teamId, err);
    }
  }
}
