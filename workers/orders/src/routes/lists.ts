import { hasMentorAccess, requireAuth } from "@g3/auth";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type OrdersDb, createOrdersDb } from "../db";
import {
  REQUEST_STATUSES,
  type RequestStatus,
  budgetCategories,
  orderRequests,
  partListItems,
  partLists,
} from "../db/schema";
import { addToList } from "../lib/lists";
import type { AppEnv } from "../types";

type ListFields = { name: string; description: string | null; isArchived: boolean };

const listValidator = (partial: boolean) =>
  validator("json", (value, c): Partial<ListFields> => {
    const v = (value ?? {}) as Record<string, unknown>;
    const fail = (error: string) => c.json({ error }, 400) as never;
    const out: Partial<ListFields> = {};
    if (!partial || v.name !== undefined) {
      if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 100) {
        return fail("name must be 1–100 characters.");
      }
      out.name = v.name.trim();
    }
    if (v.description !== undefined) {
      if (
        v.description !== null &&
        (typeof v.description !== "string" || v.description.length > 1000)
      ) {
        return fail("description must be up to 1000 characters.");
      }
      out.description = (v.description as string | null)?.trim() || null;
    }
    if (v.isArchived !== undefined) {
      if (typeof v.isArchived !== "boolean") return fail("isArchived must be true or false.");
      out.isArchived = v.isArchived;
    }
    return out;
  });

const itemsValidator = validator("json", (value, c): { requestIds: number[] } => {
  const ids = (value as { requestIds?: unknown })?.requestIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 200 ||
    !ids.every((id) => Number.isInteger(id))
  ) {
    return c.json({ error: "requestIds must be 1–200 request ids." }, 400) as never;
  }
  return { requestIds: [...new Set(ids as number[])] };
});

/** How many of a list's requests are in each status, and what the live ones cost. */
type Progress = Record<RequestStatus, number> & {
  total: number;
  /** Requests not denied or cancelled: what the list still needs or already has. */
  active: number;
  /** Known cost of the active requests (ordered prices once ordered, estimates before). */
  costCents: number;
  /** Active requests with no price yet. */
  unpriced: number;
};

const emptyProgress = (): Progress => ({
  ...(Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<RequestStatus, number>),
  total: 0,
  active: 0,
  costCents: 0,
  unpriced: 0,
});

async function progressByList(db: OrdersDb, listIds?: number[]) {
  const rows = await db
    .select({
      listId: partListItems.listId,
      status: orderRequests.status,
      count: sql<number>`count(*)`,
      costCents: sql<number>`coalesce(sum(${orderRequests.quantity} * ${orderRequests.unitPriceCents}), 0)`,
      unpriced: sql<number>`sum(case when ${orderRequests.unitPriceCents} is null then 1 else 0 end)`,
    })
    .from(partListItems)
    .innerJoin(orderRequests, eq(orderRequests.id, partListItems.requestId))
    .where(listIds ? inArray(partListItems.listId, listIds) : undefined)
    .groupBy(partListItems.listId, orderRequests.status)
    .all();
  const out = new Map<number, Progress>();
  for (const r of rows) {
    const p = out.get(r.listId) ?? emptyProgress();
    p[r.status] = r.count;
    p.total += r.count;
    if (r.status !== "denied" && r.status !== "cancelled") {
      p.active += r.count;
      p.costCents += r.costCents;
      p.unpriced += r.unpriced;
    }
    out.set(r.listId, p);
  }
  return out;
}

/** The list, if this user may rename, archive or delete it (its creator or a mentor). */
async function ownedList(
  db: OrdersDb,
  id: number,
  user: { id: string; isMentor: boolean },
): Promise<{ list: typeof partLists.$inferSelect } | { error: string; status: 403 | 404 }> {
  const list = await db.select().from(partLists).where(eq(partLists.id, id)).get();
  if (!list) return { error: "List not found.", status: 404 };
  if (list.createdById !== user.id && !user.isMentor) {
    return { error: "Only the list's creator or a mentor can change it.", status: 403 };
  }
  return { list };
}

/**
 * Lists of requests. Anyone logged in makes lists and adds or removes requests; only the creator
 * or a mentor renames, archives or deletes a list. Removing never changes the request itself.
 */
export const listsRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const [lists, progress] = await Promise.all([
      db.select().from(partLists).orderBy(desc(partLists.updatedAt)).all(),
      progressByList(db),
    ]);
    return c.json(
      lists.map((l) => ({
        ...l,
        isArchived: l.isArchived === 1,
        progress: progress.get(l.id) ?? emptyProgress(),
      })),
    );
  })
  .post("/", requireAuth, listValidator(false), async (c) => {
    const body = c.req.valid("json") as ListFields;
    const db = createOrdersDb(c.env.ORDERS_DB);
    const now = Date.now();
    const row = await db
      .insert(partLists)
      .values({
        name: body.name,
        description: body.description ?? null,
        createdById: c.get("userId"),
        createdByName: c.get("userDisplayName"),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json({ ...row, isArchived: false, progress: emptyProgress() }, 201);
  })
  /** The lists a request is on (for its page). */
  .get("/for-request/:requestId", requireAuth, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const rows = await db
      .select({ id: partLists.id, name: partLists.name })
      .from(partListItems)
      .innerJoin(partLists, eq(partLists.id, partListItems.listId))
      .where(eq(partListItems.requestId, Number(c.req.param("requestId"))))
      .orderBy(partLists.name)
      .all();
    return c.json(rows);
  })
  .get("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const db = createOrdersDb(c.env.ORDERS_DB);
    const list = await db.select().from(partLists).where(eq(partLists.id, id)).get();
    if (!list) return c.json({ error: "List not found." }, 404);
    const [rows, progress] = await Promise.all([
      db
        .select({
          request: orderRequests,
          categoryName: budgetCategories.name,
          addedByName: partListItems.addedByName,
          addedAt: partListItems.addedAt,
        })
        .from(partListItems)
        .innerJoin(orderRequests, eq(orderRequests.id, partListItems.requestId))
        .innerJoin(budgetCategories, eq(budgetCategories.id, orderRequests.categoryId))
        .where(eq(partListItems.listId, id))
        .orderBy(desc(partListItems.addedAt))
        .all(),
      progressByList(db, [id]),
    ]);
    return c.json({
      ...list,
      isArchived: list.isArchived === 1,
      progress: progress.get(id) ?? emptyProgress(),
      requests: rows.map((r) => ({
        ...r.request,
        categoryName: r.categoryName,
        addedByName: r.addedByName,
        addedAt: r.addedAt,
      })),
    });
  })
  .patch("/:id", requireAuth, listValidator(true), async (c) => {
    const id = Number(c.req.param("id"));
    const body = c.req.valid("json");
    if (Object.keys(body).length === 0) return c.json({ error: "Nothing to update." }, 400);
    const db = createOrdersDb(c.env.ORDERS_DB);
    const found = await ownedList(db, id, {
      id: c.get("userId"),
      isMentor: hasMentorAccess(c),
    });
    if ("error" in found) return c.json({ error: found.error }, found.status);
    const { isArchived, ...rest } = body;
    const row = await db
      .update(partLists)
      .set({
        ...rest,
        ...(isArchived !== undefined ? { isArchived: isArchived ? 1 : 0 } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(partLists.id, id))
      .returning()
      .get();
    return c.json({ ...row, isArchived: row.isArchived === 1 });
  })
  .delete("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const db = createOrdersDb(c.env.ORDERS_DB);
    const found = await ownedList(db, id, {
      id: c.get("userId"),
      isMentor: hasMentorAccess(c),
    });
    if ("error" in found) return c.json({ error: found.error }, found.status);
    await db.batch([
      db.delete(partListItems).where(eq(partListItems.listId, id)),
      db.delete(partLists).where(eq(partLists.id, id)),
    ]);
    return c.json({ ok: true });
  })
  .post("/:id/items", requireAuth, itemsValidator, async (c) => {
    const id = Number(c.req.param("id"));
    const { requestIds } = c.req.valid("json");
    const db = createOrdersDb(c.env.ORDERS_DB);
    const list = await db.select().from(partLists).where(eq(partLists.id, id)).get();
    if (!list) return c.json({ error: "List not found." }, 404);
    const added = await addToList(db, id, requestIds, c.get("userDisplayName"));
    if (added === null) return c.json({ error: "Some of those requests don't exist." }, 400);
    return c.json({ added });
  })
  .delete("/:id/items/:requestId", requireAuth, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const listId = Number(c.req.param("id"));
    const row = await db
      .delete(partListItems)
      .where(
        and(
          eq(partListItems.listId, listId),
          eq(partListItems.requestId, Number(c.req.param("requestId"))),
        ),
      )
      .returning()
      .get();
    if (!row) return c.json({ error: "That request isn't on this list." }, 404);
    await db.update(partLists).set({ updatedAt: Date.now() }).where(eq(partLists.id, listId));
    return c.json({ ok: true });
  });
