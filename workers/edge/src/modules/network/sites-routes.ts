import { inTeam, requireAdmin } from "@g3/auth";
import { eq, inArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { type EdgeDb, createEdgeDb } from "../../db";
import { netClients } from "../../db/schema";
import type { AppEnv } from "../../types";
import { clientName, getSettings, teamTimeZone } from "./common";
import { type Range, rangeOf, rangeQuery, usageStats } from "./range";
import { clientSites, siteClients, siteDaily, topSites } from "./sites";

/** The range the page asks for (`?from=&to=`; the billing cycle by default), with the zone. */
async function pageRange(c: Context<AppEnv>, db: EdgeDb, teamId: string) {
  const [settings, tz] = await Promise.all([getSettings(db, teamId), teamTimeZone(db, teamId)]);
  const now = Math.floor(Date.now() / 1000);
  const range = rangeOf(c, now, tz, settings.cycleStartDay);
  return "error" in range ? range : { ...range, tz, now };
}

/** Per-site usage over a range (the billing cycle by default). Admin-only: this is browsing data. */
/** A range as the pages get it (without the zone and clock it was worked out with). */
const plain = ({ tz: _tz, now: _now, ...range }: Range & { tz: string; now: number }) => range;

export const sitesRouter = new Hono<AppEnv>()
  .get("/", requireAdmin, rangeQuery, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const teamId = c.get("teamId");
    const range = await pageRange(c, db, teamId);
    if ("error" in range) return c.json({ error: range.error }, 400);
    const sites = await topSites(db, teamId, range.from, range.to);
    return c.json({ range: plain(range), sites });
  })
  .get("/site/:site", requireAdmin, rangeQuery, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const teamId = c.get("teamId");
    const site = c.req.param("site");
    const range = await pageRange(c, db, teamId);
    if ("error" in range) return c.json({ error: range.error }, 400);
    const [usage, daily] = await Promise.all([
      siteClients(db, teamId, site, range.from, range.to),
      siteDaily(db, teamId, range.tz, site, range.from, range.to),
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
      range: plain(range),
      daily,
      // Site data is hourly for 30 days, then daily: no hours of the day here.
      stats: usageStats(range, daily, null, range.now, range.tz),
      clients: usage.map((u) => {
        const cl = byMac.get(u.mac);
        return { ...u, name: cl ? clientName(cl) : u.mac };
      }),
    });
  })
  .get("/client/:mac", requireAdmin, rangeQuery, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const teamId = c.get("teamId");
    const mac = c.req.param("mac");
    const client = await db
      .select()
      .from(netClients)
      .where(inTeam(netClients, teamId, eq(netClients.mac, mac)))
      .get();
    if (!client) return c.json({ error: "Client not found." }, 404);
    const range = await pageRange(c, db, teamId);
    if ("error" in range) return c.json({ error: range.error }, 400);
    return c.json({
      range: plain(range),
      sites: await clientSites(db, teamId, mac, range.from, range.to),
    });
  });
