import { hasMentorAccess, requireAuth, requireAuthWithIdentities } from "@g3/auth";
import { sendDM } from "@g3/slack";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type OrdersDb, createOrdersDb } from "../db";
import {
  PRIORITIES,
  type Priority,
  REQUEST_STATUSES,
  type RequestStatus,
  budgetCategories,
  orderRequests,
  partLists,
  requestEvents,
} from "../db/schema";
import { type CatalogChoice, catalogItemFor, catalogPackQuantity } from "../lib/catalog";
import { type ReceiveDestination, parseDestination, sendToInventory } from "../lib/inventory";
import { addToList } from "../lib/lists";
import { formatCents } from "../lib/money";
import { packQuantityField } from "../lib/pack-quantity";
import { vendorName } from "../lib/vendors";
import type { AppEnv } from "../types";

type RequestFields = {
  url: string;
  vendor: string;
  title: string;
  sku: string | null;
  variant: string | null;
  image: string | null;
  unitPriceCents: number | null;
  currency: string;
  quantity: number;
  /** How many parts one of `quantity` is. Left out, it's the catalog part's. */
  packQuantity?: number;
  categoryId: number;
  reason: string;
  priority: Priority;
  needBy: number | null;
  storePlatform: string | null;
  storeVariantId: string | null;
};

const optionalText = (v: unknown, max: number): string | null | false => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > max) return false;
  return v.trim() || null;
};

/** Validates a full request (create) or a partial one (edit), plus its catalog choice. */
/** A new request can go straight onto a list. */
type ListChoice = { listId?: number | null };

const requestValidator = (partial: boolean) =>
  validator("json", (value, c): Partial<RequestFields> & CatalogChoice & ListChoice => {
    const v = (value ?? {}) as Record<string, unknown>;
    const out: Partial<RequestFields> & CatalogChoice & ListChoice = {};
    const fail = (error: string) => c.json({ error }, 400) as never;
    const has = (key: string) => !partial || v[key] !== undefined;

    if (has("url")) {
      let url: URL;
      try {
        url = new URL(String(v.url));
      } catch {
        return fail("url must be a link to the product.");
      }
      if (url.protocol !== "https:" && url.protocol !== "http:")
        return fail("url must be http(s).");
      out.url = url.toString();
      // No vendor given: name it from the link (also when an edit swaps in a new link).
      if (typeof v.vendor !== "string" || !v.vendor.trim()) {
        out.vendor = vendorName(url.hostname);
      }
    }
    if (typeof v.vendor === "string" && v.vendor.trim()) {
      out.vendor = vendorName(v.vendor).slice(0, 100);
    }
    if (has("title")) {
      if (typeof v.title !== "string" || !v.title.trim() || v.title.length > 300) {
        return fail("title must be 1–300 characters.");
      }
      out.title = v.title.trim();
    }
    for (const [key, max] of [
      ["sku", 100],
      ["variant", 200],
      ["image", 2000],
      ["storePlatform", 20],
      ["storeVariantId", 60],
    ] as const) {
      if (v[key] === undefined && partial) continue;
      const text = optionalText(v[key], max);
      if (text === false) return fail(`${key} must be text up to ${max} characters.`);
      out[key] = text;
    }
    if (has("unitPriceCents")) {
      const p = v.unitPriceCents ?? null;
      if (
        p !== null &&
        !(Number.isInteger(p) && (p as number) >= 0 && (p as number) <= 10_000_000)
      ) {
        return fail("unitPriceCents must be a non-negative whole number of cents.");
      }
      out.unitPriceCents = p as number | null;
    }
    if (v.currency !== undefined) {
      if (typeof v.currency !== "string" || !/^[A-Z]{3}$/.test(v.currency)) {
        return fail("currency must be a 3-letter code.");
      }
      out.currency = v.currency;
    }
    if (has("quantity")) {
      if (
        !Number.isInteger(v.quantity) ||
        (v.quantity as number) < 1 ||
        (v.quantity as number) > 10_000
      ) {
        return fail("quantity must be a whole number from 1 to 10000.");
      }
      out.quantity = v.quantity as number;
    }
    if (v.packQuantity !== undefined && v.packQuantity !== null) {
      const pack = packQuantityField(v.packQuantity);
      if (pack === null) return fail("packQuantity must be a whole number from 1 to 10000.");
      out.packQuantity = pack;
    }
    if (has("categoryId")) {
      if (!Number.isInteger(v.categoryId)) return fail("Pick a budget category.");
      out.categoryId = v.categoryId as number;
    }
    if (has("reason")) {
      if (typeof v.reason !== "string" || !v.reason.trim() || v.reason.length > 1000) {
        return fail("reason must be 1–1000 characters.");
      }
      out.reason = v.reason.trim();
    }
    // Anyone can set priority (including Blocking) and a need-by date.
    if (v.priority !== undefined || !partial) {
      const priority = v.priority ?? "normal";
      if (!PRIORITIES.includes(priority as Priority)) {
        return fail(`priority must be one of ${PRIORITIES.join(", ")}.`);
      }
      out.priority = priority as Priority;
    }
    if (v.needBy !== undefined) {
      if (v.needBy !== null && !(Number.isInteger(v.needBy) && (v.needBy as number) > 0)) {
        return fail("needBy must be a date (ms) or null.");
      }
      out.needBy = v.needBy as number | null;
    }
    if (v.catalogItemId !== undefined && v.catalogItemId !== null) {
      if (!Number.isInteger(v.catalogItemId)) return fail("catalogItemId must be an id.");
      out.catalogItemId = v.catalogItemId as number;
    }
    for (const key of ["catalogCategory", "catalogName"] as const) {
      const text = optionalText(v[key], key === "catalogName" ? 300 : 100);
      if (text === false) return fail(`${key} must be text.`);
      out[key] = text;
    }
    if (!partial && v.listId !== undefined && v.listId !== null) {
      if (!Number.isInteger(v.listId)) return fail("listId must be a list id.");
      out.listId = v.listId as number;
    }
    return out;
  });

const NEEDS_CATALOG_CATEGORY = "This part is new to the catalog: pick a catalog category for it.";

const listValidator = validator("query", (value, c): { status?: RequestStatus; mine?: "true" } => {
  const status = value.status;
  if (status !== undefined && !REQUEST_STATUSES.includes(status as RequestStatus)) {
    return c.json({ error: `status must be one of ${REQUEST_STATUSES.join(", ")}.` }, 400) as never;
  }
  return {
    status: status as RequestStatus | undefined,
    mine: value.mine === "true" ? "true" : undefined,
  };
});

const ACTIONS = {
  approve: { from: ["requested"], to: "approved", who: "mentor" },
  deny: { from: ["requested"], to: "denied", who: "mentor" },
  // Packages are opened by whoever is in the shop: anyone signed in marks them received.
  receive: { from: ["ordered"], to: "received", who: "anyone" },
  cancel: { from: ["requested", "approved"], to: "cancelled", who: "mentor-or-requester" },
} as const satisfies Record<
  string,
  { from: RequestStatus[]; to: RequestStatus; who: "mentor" | "mentor-or-requester" | "anyone" }
>;
type Action = keyof typeof ACTIONS;

type ActionInput = {
  note: string | null;
  quantity?: number;
  unitPriceCents?: number | null;
  /** When receiving: where the parts go in the Inventory app. */
  inventory?: ReceiveDestination | null;
};

const actionValidator = validator("json", (value, c): ActionInput => {
  const v = (value ?? {}) as Record<string, unknown>;
  const note = optionalText(v.note, 1000);
  if (note === false) return c.json({ error: "note must be up to 1000 characters." }, 400) as never;
  const inventory = parseDestination(v.inventory);
  if (inventory && "error" in inventory) return c.json({ error: inventory.error }, 400) as never;
  const out: ActionInput = { note, inventory };
  // Approving can adjust the quantity and price at the same time.
  if (v.quantity !== undefined) {
    if (
      !Number.isInteger(v.quantity) ||
      (v.quantity as number) < 1 ||
      (v.quantity as number) > 10_000
    ) {
      return c.json({ error: "quantity must be a whole number from 1 to 10000." }, 400) as never;
    }
    out.quantity = v.quantity as number;
  }
  if (v.unitPriceCents !== undefined) {
    const p = v.unitPriceCents;
    if (p !== null && !(Number.isInteger(p) && (p as number) >= 0 && (p as number) <= 10_000_000)) {
      return c.json(
        { error: "unitPriceCents must be a non-negative whole number of cents." },
        400,
      ) as never;
    }
    out.unitPriceCents = p as number | null;
  }
  return out;
});

/** "qty 2 → 3, price $5.00 → $4.50", or null when nothing changed. */
export function describeChanges(
  before: { quantity: number; unitPriceCents: number | null; currency: string },
  after: { quantity?: number; unitPriceCents?: number | null },
): string | null {
  const parts: string[] = [];
  if (after.quantity !== undefined && after.quantity !== before.quantity) {
    parts.push(`qty ${before.quantity} → ${after.quantity}`);
  }
  if (after.unitPriceCents !== undefined && after.unitPriceCents !== before.unitPriceCents) {
    const fmt = (c: number | null) => (c === null ? "unknown" : formatCents(c, before.currency));
    parts.push(`price ${fmt(before.unitPriceCents)} → ${fmt(after.unitPriceCents)}`);
  }
  return parts.length ? parts.join(", ") : null;
}

/** Request rows with their category name. */
function selectRequests(db: OrdersDb) {
  return db
    .select({ request: orderRequests, categoryName: budgetCategories.name })
    .from(orderRequests)
    .innerJoin(budgetCategories, eq(budgetCategories.id, orderRequests.categoryId));
}

async function openCategory(db: OrdersDb, id: number) {
  const category = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.id, id))
    .get();
  return category && !category.isArchived ? category : null;
}

export const requestsRouter = new Hono<AppEnv>()
  .get("/", requireAuth, listValidator, async (c) => {
    const { status, mine } = c.req.valid("query");
    const onlyMine = mine === "true";
    const db = createOrdersDb(c.env.ORDERS_DB);
    const filters = [
      status ? eq(orderRequests.status, status) : undefined,
      onlyMine ? eq(orderRequests.requesterId, c.get("userId")) : undefined,
    ].filter((f) => f !== undefined);
    const rows = await selectRequests(db)
      .where(filters.length ? and(...filters) : undefined)
      // Most urgent first: priority, then need-by date (none last), then oldest.
      .orderBy(
        sql`case ${orderRequests.priority} when 'blocking' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`,
        sql`${orderRequests.needBy} is null`,
        asc(orderRequests.needBy),
        asc(orderRequests.createdAt),
      )
      .all();
    return c.json(rows.map((r) => ({ ...r.request, categoryName: r.categoryName })));
  })
  .get("/:id", requireAuth, async (c) => {
    const id = Number(c.req.param("id"));
    const db = createOrdersDb(c.env.ORDERS_DB);
    const row = await selectRequests(db).where(eq(orderRequests.id, id)).get();
    if (!row) return c.json({ error: "Request not found." }, 404);
    const events = await db
      .select()
      .from(requestEvents)
      .where(eq(requestEvents.requestId, id))
      .orderBy(asc(requestEvents.createdAt), asc(requestEvents.id))
      .all();
    return c.json({ ...row.request, categoryName: row.categoryName, events });
  })
  .post("/", requireAuthWithIdentities, requestValidator(false), async (c) => {
    const {
      catalogItemId: picked,
      catalogCategory,
      catalogName,
      listId,
      ...body
    } = c.req.valid("json") as RequestFields & CatalogChoice & ListChoice;
    const catalog = { catalogItemId: picked, catalogCategory, catalogName };
    const db = createOrdersDb(c.env.ORDERS_DB);
    if (!(await openCategory(db, body.categoryId))) {
      return c.json({ error: "That budget category doesn't exist or is archived." }, 400);
    }
    if (
      listId &&
      !(await db.select({ id: partLists.id }).from(partLists).where(eq(partLists.id, listId)).get())
    ) {
      return c.json({ error: "That list doesn't exist anymore." }, 400);
    }
    // Every submitted link is in the catalog: the picked item, the one with this link, or new.
    const catalogItemId = await catalogItemFor(db, catalog, body, c.get("userDisplayName"));
    if (catalogItemId === null) return c.json({ error: NEEDS_CATALOG_CATEGORY }, 400);
    const packQuantity = body.packQuantity ?? (await catalogPackQuantity(db, catalogItemId));
    const now = Date.now();
    const row = await db
      .insert(orderRequests)
      .values({
        ...body,
        packQuantity,
        catalogItemId,
        currency: body.currency ?? "USD",
        requesterId: c.get("userId"),
        requesterName: c.get("userDisplayName"),
        requesterSlackId: c.get("userSlackId"),
        status: "requested",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    await db.insert(requestEvents).values({
      requestId: row.id,
      userId: c.get("userId"),
      userName: c.get("userDisplayName"),
      action: "created",
      createdAt: now,
    });
    if (listId) await addToList(db, listId, [row.id], c.get("userDisplayName"));
    return c.json(row, 201);
  })
  /** Edit while still awaiting a mentor (including swapping in another item): the requester or any mentor. */
  .patch("/:id", requireAuth, requestValidator(true), async (c) => {
    const id = Number(c.req.param("id"));
    const { catalogItemId: picked, catalogCategory, catalogName, ...body } = c.req.valid("json");
    const catalog = { catalogItemId: picked, catalogCategory, catalogName };
    const db = createOrdersDb(c.env.ORDERS_DB);
    const current = await db.select().from(orderRequests).where(eq(orderRequests.id, id)).get();
    if (!current) return c.json({ error: "Request not found." }, 404);
    if (current.requesterId !== c.get("userId") && !hasMentorAccess(c)) {
      return c.json({ error: "Only the requester or a mentor can edit this." }, 403);
    }
    if (current.status !== "requested") {
      return c.json({ error: "Only requests still awaiting a mentor can be edited." }, 409);
    }
    if (body.categoryId !== undefined && !(await openCategory(db, body.categoryId))) {
      return c.json({ error: "That budget category doesn't exist or is archived." }, 400);
    }
    if (Object.keys(body).length === 0) return c.json({ error: "Nothing to update." }, 400);
    // A different item (new link or option) is a different catalog item.
    let catalogItemId = current.catalogItemId;
    if (
      (body.url !== undefined && body.url !== current.url) ||
      (body.storeVariantId !== undefined && body.storeVariantId !== current.storeVariantId) ||
      catalog.catalogItemId
    ) {
      catalogItemId = await catalogItemFor(
        db,
        catalog,
        { ...current, ...body },
        c.get("userDisplayName"),
      );
      if (catalogItemId === null) return c.json({ error: NEEDS_CATALOG_CATEGORY }, 400);
    }
    const now = Date.now();
    const row = await db
      .update(orderRequests)
      .set({ ...body, catalogItemId, updatedAt: now })
      .where(and(eq(orderRequests.id, id), eq(orderRequests.status, "requested")))
      .returning()
      .get();
    if (!row) return c.json({ error: "This request was just decided; reload to see it." }, 409);
    // A new link means a different item (a mentor fixing the wrong part or supplier): keep what
    // it was in the history.
    const replaced = body.url !== undefined && body.url !== current.url;
    await db.insert(requestEvents).values({
      requestId: id,
      userId: c.get("userId"),
      userName: c.get("userDisplayName"),
      action: replaced ? "replaced" : "edited",
      note: replaced
        ? `Was ${current.quantity}× ${current.title} from ${current.vendor}: ${current.url}`
        : null,
      createdAt: now,
    });
    return c.json(row);
  })
  /**
   * Status changes: approve, deny, receive, cancel. Body: { note? }, and when approving optionally
   * { quantity?, unitPriceCents? } to adjust the line. Ordering happens through POST /orders.
   * When receiving, { inventory? } says where the parts go in the Inventory app (lib/inventory.ts).
   */
  .post("/:id/:action", requireAuth, actionValidator, async (c) => {
    const id = Number(c.req.param("id"));
    const action = c.req.param("action");
    if (!(action in ACTIONS)) {
      return c.json({ error: `action must be one of ${Object.keys(ACTIONS).join(", ")}.` }, 404);
    }
    const rule = ACTIONS[action as Action];
    const { note, quantity, unitPriceCents, inventory } = c.req.valid("json");
    const db = createOrdersDb(c.env.ORDERS_DB);

    const current = await selectRequests(db).where(eq(orderRequests.id, id)).get();
    if (!current) return c.json({ error: "Request not found." }, 404);
    const isMentor = hasMentorAccess(c);
    const isRequester = current.request.requesterId === c.get("userId");
    const allowed =
      rule.who === "anyone" || isMentor || (rule.who === "mentor-or-requester" && isRequester);
    if (!allowed) {
      return c.json(
        {
          error:
            rule.who === "mentor"
              ? "Only mentors can do that."
              : "Only the requester or a mentor can do that.",
        },
        403,
      );
    }

    // Into Inventory first: if that can't be done, the request isn't marked received.
    let inventoryNote: string | null = null;
    let inventoryLocationId: number | undefined;
    if (action === "receive" && current.request.status === "ordered") {
      const sent = await sendToInventory(c, db, [current.request], inventory ?? null);
      if ("error" in sent) return c.json({ error: sent.error }, sent.status);
      if (sent.added !== null) inventoryNote = "Added to Inventory.";
      // Where it went, for the next delivery of the same part.
      inventoryLocationId = sent.locations.get(id);
    }

    const now = Date.now();
    // Conditional on the status it's moving from, so two people acting at once can't both win.
    const row = await db
      .update(orderRequests)
      .set({
        status: rule.to,
        updatedAt: now,
        ...(action === "approve" && quantity !== undefined ? { quantity } : {}),
        ...(action === "approve" && unitPriceCents !== undefined ? { unitPriceCents } : {}),
        ...(inventoryLocationId !== undefined ? { inventoryLocationId } : {}),
      })
      .where(and(eq(orderRequests.id, id), inArray(orderRequests.status, [...rule.from])))
      .returning()
      .get();
    if (!row) {
      return c.json({ error: `Can't ${action} a request that is ${current.request.status}.` }, 409);
    }
    const changes =
      action === "approve" ? describeChanges(current.request, { quantity, unitPriceCents }) : null;
    await db.insert(requestEvents).values({
      requestId: id,
      userId: c.get("userId"),
      userName: c.get("userDisplayName"),
      action: rule.to,
      note:
        [changes && `Changed ${changes}.`, inventoryNote, note].filter(Boolean).join(" ") || null,
      createdAt: now,
    });

    if (action === "approve" && row.requesterSlackId && c.env.SLACK_BOT_TOKEN) {
      const cost =
        row.unitPriceCents === null
          ? ""
          : ` (${formatCents(row.unitPriceCents * row.quantity, row.currency)})`;
      const message = [
        `✅ ${c.get("userDisplayName")} approved your order request: ${row.quantity}× ${row.title}${cost}, charged to ${current.categoryName}.`,
        note ? `> ${note}` : null,
        `${c.env.FRONTEND_URL}/requests/${row.id}`,
      ]
        .filter(Boolean)
        .join("\n");
      c.executionCtx.waitUntil(
        sendDM(row.requesterSlackId, message, { SLACK_BOT_TOKEN: c.env.SLACK_BOT_TOKEN }).catch(
          (err) => console.error("Approval DM failed:", err),
        ),
      );
    }

    return c.json({ ...row, categoryName: current.categoryName });
  });
