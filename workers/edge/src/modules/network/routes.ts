import { requireAdmin, requireAuth } from "@g3/auth";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createEdgeDb } from "../../db";
import { netClients, netSettings } from "../../db/schema";
import { writeAudit } from "../../lib/audit";
import { DAY, billingCycle } from "../../lib/time";
import { requireAgent } from "../../middleware/auth";
import { type AppEnv, WAN_KEY } from "../../types";
import { LOOKUP_USAGE_KEY } from "../lookup/types";
import { clientName, getSettings } from "./common";
import { desiredState } from "./control";
import { controlRouter } from "./control-routes";
import { ingestUsage, parseUsageBatch } from "./ingest";
import { livePresence, onlineFlag, presenceSummary } from "./presence";
import { ingestSites, parseSiteBatch } from "./sites";
import { sitesRouter } from "./sites-routes";
import { SEVEN_DAYS, dailyFor, earliestSample, hourlyFor, project, totalsByMac } from "./usage";

const now = () => Math.floor(Date.now() / 1000);

/** Routes called by the edge agent (shared-key auth). */
export const networkAgentRouter = new Hono<AppEnv>()
  // Full desired state (blocklists, grants, switches); fetched after a sync poke.
  .get("/state", requireAgent, async (c) => c.json(await desiredState(createEdgeDb(c.env.EDGE_DB))))
  .post(
    "/usage",
    requireAgent,
    validator("json", (value, c) => {
      const batch = parseUsageBatch(value);
      if (!batch) return c.json({ error: "Invalid usage batch." }, 400);
      return batch;
    }),
    async (c) => {
      const result = await ingestUsage(createEdgeDb(c.env.EDGE_DB), c.req.valid("json"));
      return c.json(result);
    },
  )
  .post(
    "/sites",
    requireAgent,
    validator("json", (value, c) => {
      const batch = parseSiteBatch(value);
      if (!batch) return c.json({ error: "Invalid sites batch." }, 400);
      return batch;
    }),
    async (c) => c.json(await ingestSites(c.env.EDGE_DB, c.req.valid("json").rows)),
  );

/** Routes for the UI (G3ID session). Everyone can read; admins can edit. */
export const networkRouter = new Hono<AppEnv>()
  .route("/sites", sitesRouter)
  .route("/control", controlRouter)
  .get("/overview", requireAuth, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const t = now();
    const settings = await getSettings(db);
    const cycle = billingCycle(t, settings.cycleStartDay);

    const [totals, clients, daily, recent, firstTs] = await Promise.all([
      totalsByMac(db, cycle.start, cycle.end),
      db.select().from(netClients).all(),
      dailyFor(db, WAN_KEY, cycle.start, cycle.end),
      totalsByMac(db, t - SEVEN_DAYS, t + 1),
      earliestSample(db, WAN_KEY),
    ]);

    const wan = totals.get(WAN_KEY) ?? { dl: 0, ul: 0 };
    const used = wan.dl + wan.ul;
    const recentWan = recent.get(WAN_KEY) ?? { dl: 0, ul: 0 };
    const recentStart = Math.max(t - SEVEN_DAYS, firstTs ?? t);

    const byMac = new Map(clients.map((cl) => [cl.mac, cl]));
    const lookups = totals.get(LOOKUP_USAGE_KEY) ?? { dl: 0, ul: 0 };
    let attributed = 0;
    const topClients = [];
    for (const [mac, u] of totals) {
      // Pseudo-clients ("_wan", "_lookup") aren't LAN devices.
      if (mac.startsWith("_")) continue;
      attributed += u.dl + u.ul;
      const cl = byMac.get(mac);
      topClients.push({
        mac,
        name: cl ? clientName(cl) : mac,
        isInfrastructure: cl?.isInfrastructure === 1,
        dl: u.dl,
        ul: u.ul,
      });
    }
    topClients.sort((a, b) => b.dl + b.ul - (a.dl + a.ul));

    return c.json({
      now: t,
      cycle,
      capBytes: settings.capBytes,
      used,
      wan,
      // The box's own part lookups for G3 Orders (measured on the box; part of the WAN total).
      lookups,
      // WAN bytes not attributed to any LAN client or to lookups: the box's other traffic plus overhead.
      unattributed: Math.max(0, used - attributed - lookups.dl - lookups.ul),
      projection: project({
        used,
        now: t,
        cycleStart: cycle.start,
        cycleEnd: cycle.end,
        recentBytes: recentWan.dl + recentWan.ul,
        recentSeconds: t - recentStart,
      }),
      daily,
      topClients: topClients.slice(0, 10),
    });
  })
  .get("/clients", requireAuth, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const t = now();
    const settings = await getSettings(db);
    const cycle = billingCycle(t, settings.cycleStartDay);
    // Live from the box on every load, before reading the list, so devices
    // that just showed up (and ones that never use data) are in it.
    const presence = await livePresence(c.env, db);
    const [clients, cycleTotals, dayTotals] = await Promise.all([
      db.select().from(netClients).orderBy(desc(netClients.lastSeenAt)).all(),
      totalsByMac(db, cycle.start, cycle.end),
      totalsByMac(db, t - DAY, t + 1),
    ]);
    const zero = { dl: 0, ul: 0 };
    return c.json({
      cycle,
      presence: presenceSummary(presence),
      clients: clients.map((cl) => ({
        ...cl,
        isInfrastructure: cl.isInfrastructure === 1,
        name: clientName(cl),
        online: onlineFlag(presence, cl.mac),
        cycle: cycleTotals.get(cl.mac) ?? zero,
        last24h: dayTotals.get(cl.mac) ?? zero,
      })),
    });
  })
  .get("/clients/:mac", requireAuth, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const mac = c.req.param("mac");
    const presence = await livePresence(c.env, db);
    const client = await db.select().from(netClients).where(eq(netClients.mac, mac)).get();
    if (!client) return c.json({ error: "Client not found." }, 404);
    const t = now();
    const settings = await getSettings(db);
    const cycle = billingCycle(t, settings.cycleStartDay);
    const [daily, hourly] = await Promise.all([
      dailyFor(db, mac, cycle.start, cycle.end),
      hourlyFor(db, mac, t - DAY, t + 1),
    ]);
    return c.json({
      client: {
        ...client,
        isInfrastructure: client.isInfrastructure === 1,
        name: clientName(client),
        online: onlineFlag(presence, client.mac),
      },
      presence: presenceSummary(presence),
      cycle,
      daily,
      hourly,
    });
  })
  .patch(
    "/clients/:mac",
    requireAdmin,
    validator("json", (value, c) => {
      const { displayName } = (value ?? {}) as { displayName?: unknown };
      if (displayName !== null && typeof displayName !== "string") {
        return c.json({ error: "displayName must be a string or null." }, 400);
      }
      const trimmed = displayName?.trim() ?? "";
      if (trimmed.length > 64) return c.json({ error: "Name is too long." }, 400);
      return { displayName: trimmed || null };
    }),
    async (c) => {
      const db = createEdgeDb(c.env.EDGE_DB);
      const mac = c.req.param("mac");
      const { displayName } = c.req.valid("json");
      const updated = await db
        .update(netClients)
        .set({ displayName })
        .where(eq(netClients.mac, mac))
        .returning({ mac: netClients.mac });
      if (updated.length === 0) return c.json({ error: "Client not found." }, 404);
      await writeAudit(
        db,
        { id: c.get("userId"), displayName: c.get("userDisplayName") },
        "network.client.rename",
        { mac, displayName },
      );
      return c.json({ ok: true });
    },
  )
  .get("/settings", requireAuth, async (c) => {
    const { capBytes, cycleStartDay } = await getSettings(createEdgeDb(c.env.EDGE_DB));
    return c.json({ capBytes, cycleStartDay });
  })
  .patch(
    "/settings",
    requireAdmin,
    validator("json", (value, c) => {
      const { capBytes, cycleStartDay } = (value ?? {}) as Record<string, unknown>;
      const out: { capBytes?: number; cycleStartDay?: number } = {};
      if (capBytes !== undefined) {
        if (!Number.isSafeInteger(capBytes) || (capBytes as number) <= 0) {
          return c.json({ error: "capBytes must be a positive integer." }, 400);
        }
        out.capBytes = capBytes as number;
      }
      if (cycleStartDay !== undefined) {
        if (
          !Number.isInteger(cycleStartDay) ||
          (cycleStartDay as number) < 1 ||
          (cycleStartDay as number) > 31
        ) {
          return c.json({ error: "cycleStartDay must be 1-31." }, 400);
        }
        out.cycleStartDay = cycleStartDay as number;
      }
      return out;
    }),
    async (c) => {
      const db = createEdgeDb(c.env.EDGE_DB);
      const changes = c.req.valid("json");
      if (Object.keys(changes).length === 0) return c.json({ ok: true });
      await db
        .update(netSettings)
        .set({ ...changes, updatedAt: now() })
        .where(eq(netSettings.id, 1));
      await writeAudit(
        db,
        { id: c.get("userId"), displayName: c.get("userDisplayName") },
        "network.settings.update",
        changes,
      );
      return c.json({ ok: true });
    },
  );
