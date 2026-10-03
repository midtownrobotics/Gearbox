import { requireAdmin } from "@g3/auth";
import { and, count, eq, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type EdgeDb, createEdgeDb } from "../../db";
import {
  edgeStatus,
  netBlocklistDomains,
  netBlocklists,
  netClients,
  netGrants,
  netSettings,
} from "../../db/schema";
import { writeAudit } from "../../lib/audit";
import type { AppEnv } from "../../types";
import { clientName } from "./common";
import {
  GRANT_DURATIONS,
  type GrantDuration,
  MAX_BLOCKLISTS,
  activeGrants,
  bumpStateVersion,
  grantExpiry,
  listBlocklists,
  parseBlocklistInput,
  pokeAgent,
} from "./control";

const now = () => Math.floor(Date.now() / 1000);

type Ctx = {
  env: AppEnv["Bindings"];
  get(key: "userId" | "userDisplayName"): string;
  executionCtx: { waitUntil(p: Promise<unknown>): void };
};

/** Records who changed what, bumps the desired-state version, and pokes the agent. */
async function afterChange(c: Ctx, db: EdgeDb, action: string, detail: Record<string, unknown>) {
  await db.batch([
    bumpStateVersion(db),
    writeAudit(db, { id: c.get("userId"), displayName: c.get("userDisplayName") }, action, detail),
  ]);
  c.executionCtx.waitUntil(pokeAgent(c.env));
}

function replaceDomains(db: EdgeDb, blocklistId: number, domains: string[]) {
  const statements: BatchItem<"sqlite">[] = [
    db.delete(netBlocklistDomains).where(eq(netBlocklistDomains.blocklistId, blocklistId)),
  ];
  // D1 allows 100 bound parameters per statement: 2 per row.
  for (let i = 0; i < domains.length; i += 40) {
    const chunk = domains.slice(i, i + 40).map((domain) => ({ blocklistId, domain }));
    statements.push(db.insert(netBlocklistDomains).values(chunk));
  }
  return statements;
}

const blocklistBody = validator("json", (value, c) => {
  const parsed = parseBlocklistInput(value);
  if (typeof parsed === "string") return c.json({ error: parsed }, 400);
  return parsed;
});

/** Blocking controls. Admin-only. */
export const controlRouter = new Hono<AppEnv>()
  .get("/", requireAdmin, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const t = now();
    const [settings, status, blocklists, grants, clients] = await Promise.all([
      db.select().from(netSettings).where(eq(netSettings.id, 1)).get(),
      db.select().from(edgeStatus).where(eq(edgeStatus.id, 1)).get(),
      listBlocklists(db),
      activeGrants(db, t),
      db.select().from(netClients).all(),
    ]);
    if (!settings) throw new Error("net_settings row missing");
    const names = new Map(clients.map((cl) => [cl.mac, clientName(cl)]));
    const listNames = new Map(blocklists.map((l) => [l.id, l.name]));
    return c.json({
      now: t,
      enforce: settings.enforce === 1,
      dnsHardening: settings.dnsHardening === 1,
      stateVersion: settings.stateVersion,
      appliedStateVersion: status?.appliedStateVersion ?? 0,
      blocklists,
      grants: grants.map((g) => ({
        id: g.id,
        mac: g.mac,
        clientName: names.get(g.mac) ?? g.mac,
        blocklistId: g.blocklistId,
        blocklistName: g.blocklistId === null ? null : (listNames.get(g.blocklistId) ?? null),
        expiresAt: g.expiresAt,
        reason: g.reason,
        createdByName: g.createdByName,
      })),
    });
  })
  .patch(
    "/settings",
    requireAdmin,
    validator("json", (value, c) => {
      const { enforce, dnsHardening } = (value ?? {}) as Record<string, unknown>;
      const out: { enforce?: boolean; dnsHardening?: boolean } = {};
      for (const [key, v] of [
        ["enforce", enforce],
        ["dnsHardening", dnsHardening],
      ] as const) {
        if (v === undefined) continue;
        if (typeof v !== "boolean") return c.json({ error: `${key} must be true or false.` }, 400);
        out[key] = v;
      }
      return out;
    }),
    async (c) => {
      const db = createEdgeDb(c.env.EDGE_DB);
      const changes = c.req.valid("json");
      if (Object.keys(changes).length === 0) return c.json({ ok: true });
      const flag = (v: boolean | undefined) => (v === undefined ? undefined : v ? 1 : 0);
      await db
        .update(netSettings)
        .set({ enforce: flag(changes.enforce), dnsHardening: flag(changes.dnsHardening) })
        .where(eq(netSettings.id, 1));
      await afterChange(c, db, "network.control.settings", changes);
      return c.json({ ok: true });
    },
  )
  .post("/blocklists", requireAdmin, blocklistBody, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const input = c.req.valid("json");
    const existing = await db.select({ n: count() }).from(netBlocklists).get();
    if ((existing?.n ?? 0) >= MAX_BLOCKLISTS) {
      return c.json({ error: `At most ${MAX_BLOCKLISTS} blocklists.` }, 400);
    }
    const t = now();
    const [created] = await db
      .insert(netBlocklists)
      .values({
        name: input.name,
        action: input.action,
        rateKbps: input.rateKbps,
        enabled: input.enabled ? 1 : 0,
        createdAt: t,
        updatedAt: t,
      })
      .returning({ id: netBlocklists.id });
    const [first, ...rest] = replaceDomains(db, created.id, input.domains);
    await db.batch([first, ...rest]);
    await afterChange(c, db, "network.blocklist.create", { id: created.id, ...input });
    return c.json({ id: created.id });
  })
  .put("/blocklists/:id", requireAdmin, blocklistBody, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const id = Number(c.req.param("id"));
    const input = c.req.valid("json");
    const updated = await db
      .update(netBlocklists)
      .set({
        name: input.name,
        action: input.action,
        rateKbps: input.rateKbps,
        enabled: input.enabled ? 1 : 0,
        updatedAt: now(),
      })
      .where(eq(netBlocklists.id, id))
      .returning({ id: netBlocklists.id });
    if (updated.length === 0) return c.json({ error: "Blocklist not found." }, 404);
    const [first, ...rest] = replaceDomains(db, id, input.domains);
    await db.batch([first, ...rest]);
    await afterChange(c, db, "network.blocklist.update", { id, ...input });
    return c.json({ ok: true });
  })
  .delete("/blocklists/:id", requireAdmin, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const id = Number(c.req.param("id"));
    const deleted = await db
      .delete(netBlocklists)
      .where(eq(netBlocklists.id, id))
      .returning({ id: netBlocklists.id, name: netBlocklists.name });
    if (deleted.length === 0) return c.json({ error: "Blocklist not found." }, 404);
    await afterChange(c, db, "network.blocklist.delete", deleted[0]);
    return c.json({ ok: true });
  })
  .post(
    "/grants",
    requireAdmin,
    validator("json", (value, c) => {
      const { mac, blocklistId, duration, reason } = (value ?? {}) as Record<string, unknown>;
      if (typeof mac !== "string" || !mac) return c.json({ error: "mac is required." }, 400);
      if (blocklistId !== null && !Number.isInteger(blocklistId)) {
        return c.json({ error: "blocklistId must be a list id or null (all lists)." }, 400);
      }
      if (!GRANT_DURATIONS.includes(duration as GrantDuration)) {
        return c.json({ error: `duration must be one of ${GRANT_DURATIONS.join(", ")}.` }, 400);
      }
      if (
        reason !== undefined &&
        reason !== null &&
        (typeof reason !== "string" || reason.length > 200)
      ) {
        return c.json({ error: "reason must be at most 200 characters." }, 400);
      }
      return {
        mac,
        blocklistId: blocklistId as number | null,
        duration: duration as GrantDuration,
        reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
      };
    }),
    async (c) => {
      const db = createEdgeDb(c.env.EDGE_DB);
      const input = c.req.valid("json");
      const client = await db.select().from(netClients).where(eq(netClients.mac, input.mac)).get();
      if (!client) return c.json({ error: "Client not found." }, 404);
      if (input.blocklistId !== null) {
        const list = await db
          .select()
          .from(netBlocklists)
          .where(eq(netBlocklists.id, input.blocklistId))
          .get();
        if (!list) return c.json({ error: "Blocklist not found." }, 404);
      }
      const t = now();
      const expiresAt = grantExpiry(input.duration, t);
      const [created] = await db
        .insert(netGrants)
        .values({
          mac: input.mac,
          blocklistId: input.blocklistId,
          expiresAt,
          reason: input.reason,
          createdBy: c.get("userId"),
          createdByName: c.get("userDisplayName"),
          createdAt: t,
        })
        .returning({ id: netGrants.id });
      await afterChange(c, db, "network.grant.create", { id: created.id, ...input, expiresAt });
      return c.json({ id: created.id, expiresAt });
    },
  )
  .delete("/grants/:id", requireAdmin, async (c) => {
    const db = createEdgeDb(c.env.EDGE_DB);
    const id = Number(c.req.param("id"));
    const revoked = await db
      .update(netGrants)
      .set({ revokedAt: now() })
      .where(and(eq(netGrants.id, id), isNull(netGrants.revokedAt)))
      .returning({ id: netGrants.id, mac: netGrants.mac });
    if (revoked.length === 0) return c.json({ error: "Grant not found." }, 404);
    await afterChange(c, db, "network.grant.revoke", revoked[0]);
    return c.json({ ok: true });
  })
  // Re-sends the current state, e.g. after the box comes back online.
  .post("/sync", requireAdmin, async (c) => {
    c.executionCtx.waitUntil(pokeAgent(c.env));
    return c.json({ ok: true });
  });
