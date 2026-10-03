import { requireAdmin, requireAuth } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { validator } from "hono/validator";
import packageJson from "../package.json";
import { createDb } from "./db";
import { batteries, checklistIssues, checklistItems, checklistLists, settings } from "./db/schema";
import type { AppEnv } from "./types";

const base = new Hono<AppEnv>();

base.onError((err, c) => {
  console.error("[pit]", err);
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: "Internal server error.", detail: message }, 500);
});

base.use(
  "*",
  cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const listNameValidator = validator("json", (value, c) => {
  const v = value as { name?: unknown };
  if (typeof v.name !== "string" || !v.name.trim())
    return c.json({ error: "name must be a non-empty string." }, 400);
  return { name: v.name.trim() };
});

const listDescriptionValidator = validator("json", (value, c) => {
  const v = value as { description?: unknown };
  if (v.description !== null && typeof v.description !== "string")
    return c.json({ error: "description must be a string or null." }, 400);
  return { description: (v.description ?? null) as string | null };
});

const listBodyValidator = validator("json", (value, c) => {
  const v = value as { name?: unknown; description?: unknown };
  if (typeof v.name !== "string" || !v.name.trim())
    return c.json({ error: "name must be a non-empty string." }, 400);
  if (v.description !== undefined && v.description !== null && typeof v.description !== "string")
    return c.json({ error: "description must be a string or null." }, 400);
  return {
    name: v.name.trim(),
    description: (typeof v.description === "string" ? v.description : null) as string | null,
  };
});

const itemBodyValidator = validator("json", (value, c) => {
  const v = value as { name?: unknown; description?: unknown; type?: unknown };
  if (typeof v.name !== "string" || !v.name.trim())
    return c.json({ error: "name must be a non-empty string." }, 400);
  if (v.description !== undefined && v.description !== null && typeof v.description !== "string")
    return c.json({ error: "description must be a string or null." }, 400);
  if (v.type !== undefined && v.type !== "item" && v.type !== "topic")
    return c.json({ error: "type must be 'item' or 'topic'." }, 400);
  return {
    name: v.name.trim(),
    description: (typeof v.description === "string" ? v.description : null) as string | null,
    type: ((v.type as string) ?? "item") as "item" | "topic",
  };
});

const batteryStateValidator = validator("json", (value, c) => {
  const v = value as { state?: unknown };
  const valid = ["Charging", "In Robot", "Idle", "Broken", "Next Up"] as const;
  if (!valid.includes(v.state as (typeof valid)[number]))
    return c.json({ error: "state must be Charging, In Robot, Idle, or Broken, or Next Up." }, 400);
  return { state: v.state as (typeof valid)[number] };
});

const batteryVoltageValidator = validator("json", (value, c) => {
  const v = value as { voltage?: unknown };
  if (v.voltage !== null && typeof v.voltage !== "number")
    return c.json({ error: "voltage must be a number or null." }, 400);
  return { voltage: (v.voltage ?? null) as number | null };
});

const checkedValidator = validator("json", (value, c) => {
  const v = value as { checked?: unknown };
  if (typeof v.checked !== "boolean") return c.json({ error: "checked must be a boolean." }, 400);
  return { checked: v.checked };
});

const issueTextValidator = validator("json", (value, c) => {
  const v = value as { text?: unknown };
  if (typeof v.text !== "string" || !v.text.trim())
    return c.json({ error: "text must be a non-empty string." }, 400);
  return { text: v.text.trim() };
});

const SETTING_KEYS = [
  "eventKey",
  "nexusEventKey",
  "tbaAuthKey",
  "nexusApiKey",
  "iframeUrl",
] as const;
type SettingKey = (typeof SETTING_KEYS)[number];

interface NexusMonitorData {
  matches?: unknown[];
  isRealNexus?: boolean;
  [key: string]: unknown;
}

interface TbaScheduleMatch {
  comp_level?: string;
  match_number?: number;
  predicted_time?: number | null;
  time?: number | null;
  alliances?: {
    blue?: { team_keys?: string[] };
    red?: { team_keys?: string[] };
  };
}

interface MonitorScheduleMatch {
  label: string;
  status: "Queuing soon";
  blueTeams: string[] | null;
  redTeams: string[] | null;
  times: {
    estimatedStartTime: number | null;
    estimatedQueueTime: number | null;
  };
}

const settingsValidator = validator("json", (value, c): Partial<Record<SettingKey, string>> => {
  const v = (value ?? {}) as Record<string, unknown>;
  const out: Partial<Record<SettingKey, string>> = {};
  for (const k of SETTING_KEYS) {
    if (v[k] !== undefined) {
      if (typeof v[k] !== "string")
        return c.json({ error: `${k} must be a string.` }, 400) as never;
      out[k] = (v[k] as string).trim();
    }
  }
  return out;
});

const reorderValidator = validator("json", (value, c) => {
  const v = value as { ids?: unknown };
  if (
    !Array.isArray(v.ids) ||
    !v.ids.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)
  )
    return c.json({ error: "ids must be an array of positive integers." }, 400);
  return { ids: v.ids as number[] };
});

// Reads a setting from the DB, falling back to a default (e.g. an env var).
async function getSetting(
  db: ReturnType<typeof createDb>,
  key: string,
  fallback: string,
): Promise<string> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value ?? fallback;
}

// Shared select shape for list queries — counts only checkable items (type = 'item')
const listSelect = {
  id: checklistLists.id,
  name: checklistLists.name,
  description: checklistLists.description,
  createdAt: checklistLists.createdAt,
  itemCount: sql<number>`count(case when ${checklistItems.type} = 'item' then 1 end)`,
  checkedCount: sql<number>`count(case when ${checklistItems.type} = 'item' and ${checklistItems.checked} = 1 then 1 end)`,
};

const app = base
  .get("/health", (c) => c.json({ status: "ok", service: "pit", version: packageJson.version }))

  .get("/me", requireAuth, (c) =>
    c.json({
      id: c.get("userId"),
      isAdmin: c.get("userIsAdmin"),
      email: c.get("userEmail"),
      displayName: c.get("userDisplayName"),
    }),
  )

  // Lists — reads
  .get("/lists", requireAuth, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const rows = await db
      .select(listSelect)
      .from(checklistLists)
      .leftJoin(checklistItems, eq(checklistItems.listId, checklistLists.id))
      .groupBy(checklistLists.id);
    return c.json(rows);
  })

  .get("/lists/:id", requireAuth, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);

    const db = createDb(c.env.PIT_DB);
    const [row] = await db
      .select(listSelect)
      .from(checklistLists)
      .leftJoin(checklistItems, eq(checklistItems.listId, checklistLists.id))
      .where(eq(checklistLists.id, id))
      .groupBy(checklistLists.id);
    if (!row) return c.json({ error: "List not found." }, 404);
    return c.json(row);
  })

  // Items — reads
  .get("/lists/:id/items", requireAuth, async (c) => {
    const listId = parseId(c.req.param("id"));
    if (!listId) return c.json({ error: "Invalid id." }, 400);

    const db = createDb(c.env.PIT_DB);
    const [list] = await db.select().from(checklistLists).where(eq(checklistLists.id, listId));
    if (!list) return c.json({ error: "List not found." }, 404);

    const items = await db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.listId, listId))
      .orderBy(checklistItems.index);
    return c.json(items);
  })

  // Issues — reads (all)
  .get("/issues", requireAuth, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const issues = await db
      .select({
        id: checklistIssues.id,
        itemId: checklistIssues.itemId,
        itemName: checklistItems.name,
        listId: checklistLists.id,
        listName: checklistLists.name,
        text: checklistIssues.text,
        createdAt: checklistIssues.createdAt,
      })
      .from(checklistIssues)
      .innerJoin(checklistItems, eq(checklistIssues.itemId, checklistItems.id))
      .innerJoin(checklistLists, eq(checklistItems.listId, checklistLists.id))
      .orderBy(checklistIssues.createdAt);
    return c.json(issues);
  })

  // Issues — reads (per list)
  .get("/lists/:id/issues", requireAuth, async (c) => {
    const listId = parseId(c.req.param("id"));
    if (!listId) return c.json({ error: "Invalid id." }, 400);

    const db = createDb(c.env.PIT_DB);
    const [list] = await db.select().from(checklistLists).where(eq(checklistLists.id, listId));
    if (!list) return c.json({ error: "List not found." }, 404);

    const issues = await db
      .select({
        id: checklistIssues.id,
        itemId: checklistIssues.itemId,
        text: checklistIssues.text,
        createdAt: checklistIssues.createdAt,
      })
      .from(checklistIssues)
      .innerJoin(checklistItems, eq(checklistIssues.itemId, checklistItems.id))
      .where(eq(checklistItems.listId, listId))
      .orderBy(checklistIssues.createdAt);
    return c.json(issues);
  })

  // Lists — writes
  .post("/lists", requireAuth, listBodyValidator, async (c) => {
    const { name, description } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const now = Math.floor(Date.now() / 1000);
    const result = await db.insert(checklistLists).values({ name, description, createdAt: now });
    const [created] = await db
      .select()
      .from(checklistLists)
      .where(eq(checklistLists.id, Number(result.meta.last_row_id)));
    return c.json(created, 201);
  })

  .delete("/lists/:id", requireAuth, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);

    const db = createDb(c.env.PIT_DB);
    const [existing] = await db.select().from(checklistLists).where(eq(checklistLists.id, id));
    if (!existing) return c.json({ error: "List not found." }, 404);

    const itemIds = (
      await db
        .select({ id: checklistItems.id })
        .from(checklistItems)
        .where(eq(checklistItems.listId, id))
    ).map((i) => i.id);

    if (itemIds.length > 0) {
      await db.delete(checklistIssues).where(inArray(checklistIssues.itemId, itemIds));
    }
    await db.delete(checklistItems).where(eq(checklistItems.listId, id));
    await db.delete(checklistLists).where(eq(checklistLists.id, id));
    return c.json({ success: true });
  })

  .patch("/lists/:id/name", requireAuth, listNameValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);

    const { name } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const [existing] = await db.select().from(checklistLists).where(eq(checklistLists.id, id));
    if (!existing) return c.json({ error: "List not found." }, 404);

    await db.update(checklistLists).set({ name }).where(eq(checklistLists.id, id));
    const [updated] = await db.select().from(checklistLists).where(eq(checklistLists.id, id));
    return c.json(updated);
  })

  .patch("/lists/:id/description", requireAuth, listDescriptionValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);

    const { description } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const [existing] = await db.select().from(checklistLists).where(eq(checklistLists.id, id));
    if (!existing) return c.json({ error: "List not found." }, 404);

    await db.update(checklistLists).set({ description }).where(eq(checklistLists.id, id));
    const [updated] = await db.select().from(checklistLists).where(eq(checklistLists.id, id));
    return c.json(updated);
  })

  // Items — writes
  .patch("/lists/:id/items/reorder", requireAuth, reorderValidator, async (c) => {
    const listId = parseId(c.req.param("id"));
    if (!listId) return c.json({ error: "Invalid id." }, 400);

    const { ids } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);

    const existing = await db
      .select({ id: checklistItems.id })
      .from(checklistItems)
      .where(eq(checklistItems.listId, listId));

    const existingIds = new Set(existing.map((i) => i.id));
    if (ids.length !== existingIds.size || !ids.every((id) => existingIds.has(id)))
      return c.json({ error: "ids must contain every item in the list exactly once." }, 400);

    for (let i = 0; i < ids.length; i++) {
      await db.update(checklistItems).set({ index: i }).where(eq(checklistItems.id, ids[i]));
    }
    return c.json({ success: true });
  })

  .post("/lists/:id/items", requireAuth, itemBodyValidator, async (c) => {
    const listId = parseId(c.req.param("id"));
    if (!listId) return c.json({ error: "Invalid list id." }, 400);

    const { name, description, type } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const [list] = await db.select().from(checklistLists).where(eq(checklistLists.id, listId));
    if (!list) return c.json({ error: "List not found." }, 404);

    const existing = await db
      .select({ id: checklistItems.id })
      .from(checklistItems)
      .where(eq(checklistItems.listId, listId));
    const index = existing.length;

    const now = Math.floor(Date.now() / 1000);
    const result = await db
      .insert(checklistItems)
      .values({ listId, index, type, name, description, createdAt: now });
    const [created] = await db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.id, Number(result.meta.last_row_id)));
    return c.json(created, 201);
  })

  .delete("/lists/:id/items/:itemId", requireAuth, async (c) => {
    const listId = parseId(c.req.param("id"));
    const itemId = parseId(c.req.param("itemId"));
    if (!listId || !itemId) return c.json({ error: "Invalid id." }, 400);

    const db = createDb(c.env.PIT_DB);
    const [item] = await db.select().from(checklistItems).where(eq(checklistItems.id, itemId));
    if (!item || item.listId !== listId) return c.json({ error: "Item not found." }, 404);

    await db.delete(checklistIssues).where(eq(checklistIssues.itemId, itemId));
    await db.delete(checklistItems).where(eq(checklistItems.id, itemId));
    return c.json({ success: true });
  })

  .patch("/lists/:id/items/:itemId/name", requireAuth, listNameValidator, async (c) => {
    const listId = parseId(c.req.param("id"));
    const itemId = parseId(c.req.param("itemId"));
    if (!listId || !itemId) return c.json({ error: "Invalid id." }, 400);

    const { name } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const [item] = await db.select().from(checklistItems).where(eq(checklistItems.id, itemId));
    if (!item || item.listId !== listId) return c.json({ error: "Item not found." }, 404);

    await db.update(checklistItems).set({ name }).where(eq(checklistItems.id, itemId));
    const [updated] = await db.select().from(checklistItems).where(eq(checklistItems.id, itemId));
    return c.json(updated);
  })

  .patch(
    "/lists/:id/items/:itemId/description",
    requireAuth,
    listDescriptionValidator,
    async (c) => {
      const listId = parseId(c.req.param("id"));
      const itemId = parseId(c.req.param("itemId"));
      if (!listId || !itemId) return c.json({ error: "Invalid id." }, 400);

      const { description } = c.req.valid("json");
      const db = createDb(c.env.PIT_DB);
      const [item] = await db.select().from(checklistItems).where(eq(checklistItems.id, itemId));
      if (!item || item.listId !== listId) return c.json({ error: "Item not found." }, 404);

      await db.update(checklistItems).set({ description }).where(eq(checklistItems.id, itemId));
      const [updated] = await db.select().from(checklistItems).where(eq(checklistItems.id, itemId));
      return c.json(updated);
    },
  )

  // Checked state — no auth required (runner is public)
  .patch("/lists/:id/items/:itemId/checked", requireAuth, checkedValidator, async (c) => {
    const listId = parseId(c.req.param("id"));
    const itemId = parseId(c.req.param("itemId"));
    if (!listId || !itemId) return c.json({ error: "Invalid id." }, 400);

    const { checked } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const [item] = await db.select().from(checklistItems).where(eq(checklistItems.id, itemId));
    if (!item || item.listId !== listId) return c.json({ error: "Item not found." }, 404);

    await db.update(checklistItems).set({ checked }).where(eq(checklistItems.id, itemId));
    const [updated] = await db.select().from(checklistItems).where(eq(checklistItems.id, itemId));
    return c.json(updated);
  })

  .post("/lists/:id/reset", requireAuth, async (c) => {
    const listId = parseId(c.req.param("id"));
    if (!listId) return c.json({ error: "Invalid id." }, 400);

    const db = createDb(c.env.PIT_DB);
    const [list] = await db.select().from(checklistLists).where(eq(checklistLists.id, listId));
    if (!list) return c.json({ error: "List not found." }, 404);

    await db
      .update(checklistItems)
      .set({ checked: false })
      .where(eq(checklistItems.listId, listId));
    return c.json({ success: true });
  })

  // Issues — no auth required (runner is public)
  .post("/lists/:id/items/:itemId/issues", requireAuth, issueTextValidator, async (c) => {
    const listId = parseId(c.req.param("id"));
    const itemId = parseId(c.req.param("itemId"));
    if (!listId || !itemId) return c.json({ error: "Invalid id." }, 400);

    const { text } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const [item] = await db.select().from(checklistItems).where(eq(checklistItems.id, itemId));
    if (!item || item.listId !== listId) return c.json({ error: "Item not found." }, 404);

    const now = Math.floor(Date.now() / 1000);
    const result = await db.insert(checklistIssues).values({ itemId, text, createdAt: now });
    const [created] = await db
      .select()
      .from(checklistIssues)
      .where(eq(checklistIssues.id, Number(result.meta.last_row_id)));
    return c.json(created, 201);
  })

  .delete("/lists/:id/items/:itemId/issues/:issueId", requireAuth, async (c) => {
    const listId = parseId(c.req.param("id"));
    const itemId = parseId(c.req.param("itemId"));
    const issueId = parseId(c.req.param("issueId"));
    if (!listId || !itemId || !issueId) return c.json({ error: "Invalid id." }, 400);

    const db = createDb(c.env.PIT_DB);
    const [item] = await db.select().from(checklistItems).where(eq(checklistItems.id, itemId));
    if (!item || item.listId !== listId) return c.json({ error: "Item not found." }, 404);

    const [issue] = await db.select().from(checklistIssues).where(eq(checklistIssues.id, issueId));
    if (!issue || issue.itemId !== itemId) return c.json({ error: "Issue not found." }, 404);

    await db.delete(checklistIssues).where(eq(checklistIssues.id, issueId));
    return c.json({ success: true });
  })

  // Batteries
  .get("/batteries", requireAuth, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const rows = await db.select().from(batteries).orderBy(batteries.createdAt);
    return c.json(rows);
  })

  .post("/batteries", requireAuth, listNameValidator, async (c) => {
    const { name } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const now = Math.floor(Date.now() / 1000);
    const result = await db
      .insert(batteries)
      .values({ name, state: "Idle", stateSince: Date.now(), createdAt: now });
    const [created] = await db
      .select()
      .from(batteries)
      .where(eq(batteries.id, Number(result.meta.last_row_id)));
    return c.json(created, 201);
  })

  .delete("/batteries/:id", requireAuth, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const db = createDb(c.env.PIT_DB);
    const [existing] = await db.select().from(batteries).where(eq(batteries.id, id));
    if (!existing) return c.json({ error: "Battery not found." }, 404);
    await db.delete(batteries).where(eq(batteries.id, id));
    return c.json({ success: true });
  })

  .patch("/batteries/:id/state", requireAuth, batteryStateValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const { state } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const [existing] = await db.select().from(batteries).where(eq(batteries.id, id));
    if (!existing) return c.json({ error: "Battery not found." }, 404);
    const tracksVoltage = state === "In Robot" || state === "Next Up";
    // Count a use each time the battery newly enters the robot.
    const enteringRobot = state === "In Robot" && existing.state !== "In Robot";
    const baseUseCount = typeof existing.useCount === "number" ? existing.useCount : 0;
    const newUseCount = enteringRobot ? baseUseCount + 1 : baseUseCount;
    await db
      .update(batteries)
      .set({
        state,
        stateSince: Date.now(),
        voltage: tracksVoltage ? (existing.voltage ?? null) : null,
        useCount: newUseCount,
      })
      .where(eq(batteries.id, id));
    const [updated] = await db.select().from(batteries).where(eq(batteries.id, id));
    return c.json(updated);
  })

  .post("/batteries/:id/reset-uses", requireAuth, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const db = createDb(c.env.PIT_DB);
    const [existing] = await db.select().from(batteries).where(eq(batteries.id, id));
    if (!existing) return c.json({ error: "Battery not found." }, 404);
    await db.update(batteries).set({ useCount: 0 }).where(eq(batteries.id, id));
    const [updated] = await db.select().from(batteries).where(eq(batteries.id, id));
    return c.json(updated);
  })

  .patch("/batteries/:id/voltage", requireAuth, batteryVoltageValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid id." }, 400);
    const { voltage } = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    const [existing] = await db.select().from(batteries).where(eq(batteries.id, id));
    if (!existing) return c.json({ error: "Battery not found." }, 404);
    await db.update(batteries).set({ voltage }).where(eq(batteries.id, id));
    const [updated] = await db.select().from(batteries).where(eq(batteries.id, id));
    return c.json(updated);
  })

  // Global reset — unchecks all items across all lists, preserves issues
  .post("/reset", requireAuth, async (c) => {
    const db = createDb(c.env.PIT_DB);
    await db.update(checklistItems).set({ checked: false });
    return c.json({ success: true });
  })

  // Pit monitor — proxies external APIs so the frontend avoids CORS
  .get("/monitor/data", requireAuth, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const team = c.env.TEAM_NUMBER;
    const eventKey = await getSetting(db, "eventKey", c.env.EVENT_KEY);
    const nexusEventKey = await getSetting(db, "nexusEventKey", c.env.EVENT_KEY);
    const tbaKey = await getSetting(db, "tbaAuthKey", c.env.TBA_AUTH_KEY);
    const nexusKey = await getSetting(db, "nexusApiKey", c.env.NEXUS_API_KEY);
    const year = new Date().getFullYear();

    const [nexusResult, tbaResult, tbaRankingsResult, sbResult, tbaScheduleResult] =
      await Promise.allSettled([
        nexusEventKey && nexusKey
          ? fetch(`https://frc.nexus/api/v1/event/${nexusEventKey}`, {
              headers: { "Nexus-Api-Key": nexusKey },
            }).then((r) => (r.ok ? r.json() : null))
          : Promise.resolve(null),
        eventKey && tbaKey
          ? fetch(
              `https://www.thebluealliance.com/api/v3/team/frc${team}/event/${eventKey}/status`,
              {
                headers: { "X-TBA-Auth-Key": tbaKey },
              },
            ).then((r) => (r.ok ? r.json() : null))
          : Promise.resolve(null),
        eventKey && tbaKey
          ? fetch(`https://www.thebluealliance.com/api/v3/event/${eventKey}/rankings`, {
              headers: { "X-TBA-Auth-Key": tbaKey },
            }).then((r) => (r.ok ? r.json() : null))
          : Promise.resolve(null),
        team
          ? fetch(`https://api.statbotics.io/v3/team_year/${team}/${year}`).then((r) =>
              r.ok ? r.json() : null,
            )
          : Promise.resolve(null),
        eventKey && tbaKey
          ? fetch(`https://www.thebluealliance.com/api/v3/event/${eventKey}/matches`, {
              headers: { "X-TBA-Auth-Key": tbaKey },
            }).then((r) => (r.ok ? r.json() : null))
          : Promise.resolve(null),
      ]);

    const nexus = nexusResult.status === "fulfilled" ? nexusResult.value : null;
    const tba = tbaResult.status === "fulfilled" ? tbaResult.value : null;
    const tbaRankings = tbaRankingsResult.status === "fulfilled" ? tbaRankingsResult.value : null;
    const sb = sbResult.status === "fulfilled" ? sbResult.value : null;
    const tbaSchedule = tbaScheduleResult.status === "fulfilled" ? tbaScheduleResult.value : null;

    // biome-ignore lint/suspicious/noExplicitAny: external API shapes
    const tbaAny = tba as any;
    // biome-ignore lint/suspicious/noExplicitAny: external API shapes
    const sbAny = sb as any;
    // biome-ignore lint/suspicious/noExplicitAny: external API shapes
    const tbaRankingsAny = tbaRankings as any;

    const record = tbaAny?.qual?.ranking?.record;
    const ourRank = tbaAny?.qual?.ranking?.rank ?? null;
    const ranking =
      tbaAny?.qual?.ranking || sbAny
        ? {
            rank: ourRank,
            wins: record?.wins ?? sbAny?.record?.wins ?? 0,
            losses: record?.losses ?? sbAny?.record?.losses ?? 0,
            ties: record?.ties ?? sbAny?.record?.ties ?? 0,
            rp: tbaAny?.qual?.ranking?.ranking_points ?? sbAny?.event_points ?? 0,
            epa: sbAny?.epa?.breakdown?.total_points ?? 0,
          }
        : null;

    // Build context rankings: top 3 and teams around us
    interface RankingInfo {
      rank: number;
      team: string;
    }
    type ContextRankings = { top3: RankingInfo[]; context: RankingInfo[] } | null;
    let contextRankings: ContextRankings = null;
    if (tbaRankingsAny?.rankings && Array.isArray(tbaRankingsAny.rankings) && ourRank) {
      interface TbaRanking {
        rank: number;
        team_key: string;
      }
      const top3 = tbaRankingsAny.rankings.slice(0, 3).map((r: TbaRanking) => ({
        rank: r.rank as number,
        team: (r.team_key as string).replace("frc", ""),
      }));

      // Logic for "around us" based on rank position
      let contextRanks: number[] = [];
      if (ourRank <= 3) {
        // Top 3: show #4, #5, #6
        contextRanks = [4, 5, 6];
      } else if (ourRank === 4) {
        // #4: show 3 below us (#5, #6, #7) to avoid intersecting with top 3
        contextRanks = [5, 6, 7];
      } else if (ourRank === 5) {
        // #5: show 1 above and 2 below
        contextRanks = [4, 6, 7];
      } else if (ourRank === 6) {
        // #6: show 2 above and 1 below
        contextRanks = [4, 5, 7];
      } else {
        // #7+: show 3 above us
        contextRanks = [ourRank - 3, ourRank - 2, ourRank - 1];
      }

      const context = contextRanks
        .map((r) => tbaRankingsAny.rankings.find((rank: TbaRanking) => rank.rank === r))
        .filter(Boolean)
        .map((r: TbaRanking) => ({
          rank: r.rank as number,
          team: (r.team_key as string).replace("frc", ""),
        }));

      contextRankings = { top3, context };
    }

    // Fallback to Blue Alliance schedule if Nexus is unavailable
    let finalNexus = nexus as NexusMonitorData | null;
    const isRealNexus = Boolean(finalNexus?.matches?.length);
    if (!isRealNexus && tbaSchedule && Array.isArray(tbaSchedule)) {
      // Build a Nexus-like schedule from Blue Alliance data
      const tbaMatches = tbaSchedule as TbaScheduleMatch[];
      finalNexus = {
        matches: tbaMatches
          .filter((match) => match.comp_level && match.match_number)
          .map<MonitorScheduleMatch>((match) => ({
            label: `${match.comp_level?.toUpperCase()}${match.match_number}`,
            status: "Queuing soon" as const, // Blue Alliance doesn't provide status, default to queuing soon
            blueTeams:
              match.alliances?.blue?.team_keys?.map((teamKey) => teamKey.replace("frc", "")) ??
              null,
            redTeams:
              match.alliances?.red?.team_keys?.map((teamKey) => teamKey.replace("frc", "")) ?? null,
            times: {
              estimatedStartTime: match.predicted_time
                ? match.predicted_time * 1000
                : match.time
                  ? match.time * 1000
                  : null,
              estimatedQueueTime: match.predicted_time ? (match.predicted_time - 300) * 1000 : null, // Estimate queue 5min before
            },
          }))
          .sort((a, b) => {
            const timeA = a.times.estimatedStartTime ?? 0;
            const timeB = b.times.estimatedStartTime ?? 0;
            return timeA - timeB;
          }),
        isRealNexus: false,
      };
    }
    if (finalNexus && isRealNexus) {
      finalNexus.isRealNexus = true;
    }

    return c.json({ teamNumber: team, nexus: finalNexus, ranking, contextRankings });
  })

  // Pit monitor settings — read-only, public (display-only settings like iframe URL)
  .get("/monitor/settings", requireAuth, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const iframeUrl = await getSetting(db, "iframeUrl", "");
    return c.json({
      iframeUrl: iframeUrl || undefined,
    });
  })

  // Admin — settings (admin only). Event key + external API keys live in the DB
  // so they're configurable at runtime; env vars are the fallback defaults.
  .get("/admin/settings", requireAdmin, async (c) => {
    const db = createDb(c.env.PIT_DB);
    const [eventKey, nexusEventKey, tbaAuthKey, nexusApiKey, iframeUrl] = await Promise.all([
      getSetting(db, "eventKey", c.env.EVENT_KEY),
      getSetting(db, "nexusEventKey", c.env.EVENT_KEY),
      getSetting(db, "tbaAuthKey", c.env.TBA_AUTH_KEY),
      getSetting(db, "nexusApiKey", c.env.NEXUS_API_KEY),
      getSetting(db, "iframeUrl", ""),
    ]);
    return c.json({
      eventKey,
      nexusEventKey,
      tbaAuthKey,
      nexusApiKey,
      iframeUrl,
      teamNumber: c.env.TEAM_NUMBER,
    });
  })

  .patch("/admin/settings", requireAdmin, settingsValidator, async (c) => {
    const updates = c.req.valid("json");
    const db = createDb(c.env.PIT_DB);
    await Promise.all(
      Object.entries(updates).map(([key, value]) =>
        db
          .insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({ target: settings.key, set: { value } }),
      ),
    );
    return c.json({ ok: true });
  });

export type PitApp = typeof app;
export default app;
