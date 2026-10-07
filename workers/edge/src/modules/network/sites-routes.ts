import { inTeam, requireAdmin } from "@g3/auth";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { type EdgeDb, createEdgeDb } from "../../db";
import { netClients } from "../../db/schema";
import { billingCycle } from "../../lib/time";
import type { AppEnv } from "../../types";
import { clientName, getSettings, teamTimeZone } from "./common";
import { clientSites, siteClients, siteDaily, topSites } from "./sites";

async function currentCycle(db: EdgeDb, teamId: string) {
  const [settings, tz] = await Promise.all([getSettings(db, teamId), teamTimeZone(db, teamId)]);
  return { tz, ...billingCycle(Math.floor(Date.now() / 1000), settings.cycleStartDay, tz) };
}

/** Per-site usage for the current billing cycle. Admin-only: this is browsing data. */
export const sitesRouter = new Hono<AppEnv>()
  .get("/", requireAdmin, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const teamId = c.get("teamId");
    const { tz: _tz, ...cycle } = await currentCycle(db, teamId);
    const sites = await topSites(db, teamId, cycle.start, cycle.end);
    return c.json({ cycle, sites });
  })
  .get("/site/:site", requireAdmin, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const teamId = c.get("teamId");
    const site = c.req.param("site");
    const { tz, ...cycle } = await currentCycle(db, teamId);
    const [usage, daily] = await Promise.all([
      siteClients(db, teamId, site, cycle.start, cycle.end),
      siteDaily(db, teamId, tz, site, cycle.start, cycle.end),
    ]);
    const macs = usage.map((u) => u.mac);
    const clients = macs.length
      ? await db
          .select()
          .from(netClients)
          .where(inTeam(netClients, teamId, inArray(netClients.mac, macs)))
          .all()
      : [];
    const byMac = new Map(clients.map((cl) => [cl.mac, cl]));
    return c.json({
      site,
      cycle,
      daily,
      clients: usage.map((u) => {
        const cl = byMac.get(u.mac);
        return { ...u, name: cl ? clientName(cl) : u.mac };
      }),
    });
  })
  .get("/client/:mac", requireAdmin, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const teamId = c.get("teamId");
    const mac = c.req.param("mac");
    const client = await db
      .select()
      .from(netClients)
      .where(inTeam(netClients, teamId, eq(netClients.mac, mac)))
      .get();
    if (!client) return c.json({ error: "Client not found." }, 404);
    const { tz: _tz, ...cycle } = await currentCycle(db, teamId);
    return c.json({ cycle, sites: await clientSites(db, teamId, mac, cycle.start, cycle.end) });
  });
