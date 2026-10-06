import { hasMentorAccess, requireAuth, requireMentor } from "@g3/auth";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createOrdersDb } from "../db";
import {
  budgetCategories,
  orderCharges,
  orderRequests,
  requestEvents,
  vendorOrders,
} from "../db/schema";
import { chargesByCategory, lineTotal, orderFees } from "../lib/accounting";
import { recordPrices } from "../lib/catalog";
import { inChunks } from "../lib/chunks";
import { csvDate, csvMoney, csvRow } from "../lib/csv";
import { fiscalLabel, fiscalRange, fiscalYearOf } from "../lib/fiscal";
import { importSheet } from "../lib/sheet-import";
import { vendorName } from "../lib/vendors";
import type { AppEnv } from "../types";
import { describeChanges } from "./requests";

type PlaceOrder = {
  vendor: string;
  lines: { requestId: number; quantity: number; unitPriceCents: number }[];
  shippingCents: number;
  taxCents: number;
  tracking: string | null;
};

const cents = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100_000_000;

const placeValidator = validator("json", (value, c): PlaceOrder => {
  const v = (value ?? {}) as Record<string, unknown>;
  const fail = (error: string) => c.json({ error }, 400) as never;
  if (typeof v.vendor !== "string" || !v.vendor.trim()) return fail("vendor is required.");
  if (!Array.isArray(v.lines) || v.lines.length === 0 || v.lines.length > 200) {
    return fail("An order needs 1–200 lines.");
  }
  const lines: PlaceOrder["lines"] = [];
  const seen = new Set<number>();
  for (const raw of v.lines as Record<string, unknown>[]) {
    const { requestId, quantity, unitPriceCents } = raw ?? {};
    if (!Number.isInteger(requestId) || seen.has(requestId as number))
      return fail("Each line needs a distinct requestId.");
    if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 10_000) {
      return fail("Quantities must be whole numbers from 1 to 10000.");
    }
    if (!cents(unitPriceCents)) return fail("Every line needs a price (whole cents, 0 or more).");
    seen.add(requestId as number);
    lines.push({
      requestId: requestId as number,
      quantity: quantity as number,
      unitPriceCents: unitPriceCents as number,
    });
  }
  const shippingCents = v.shippingCents ?? 0;
  const taxCents = v.taxCents ?? 0;
  if (!cents(shippingCents) || !cents(taxCents)) {
    return fail("Shipping and tax must be whole cents, 0 or more.");
  }
  const tracking =
    typeof v.tracking === "string" && v.tracking.trim() ? v.tracking.trim().slice(0, 100) : null;
  return {
    vendor: vendorName(v.vendor).slice(0, 100),
    lines,
    shippingCents: shippingCents as number,
    taxCents: taxCents as number,
    tracking,
  };
});

// The team's order-sheet columns, consistently capitalized. The import also accepts the sheet's
// original spellings ("unit cost", "Budget Cat", "placed by:", ...).
const CSV_HEADER = [
  "Part",
  "Supplier",
  "Part Number/SKU",
  "Unit Cost",
  "Quantity",
  "Link",
  "Budget Category",
  "Total Cost",
  "Notes",
  "Order Placed Date",
  "Placed By",
  "Tracking #",
  "Package Received",
  "Received By",
];

const RECENT_DAYS = 14;

const receiveValidator = validator("json", (value, c): { ids: number[] } => {
  const ids = (value as { ids?: unknown })?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 200 ||
    !ids.every((id) => Number.isInteger(id) && id > 0)
  ) {
    return c.json({ error: "ids must be 1–200 request ids." }, 400) as never;
  }
  return { ids: [...new Set(ids as number[])] };
});

const trackingValidator = validator("json", (value, c): { tracking: string | null } => {
  const t = (value as { tracking?: unknown })?.tracking;
  if (t !== null && (typeof t !== "string" || t.length > 100)) {
    return c.json({ error: "tracking must be up to 100 characters, or null." }, 400) as never;
  }
  return { tracking: typeof t === "string" && t.trim() ? t.trim() : null };
});

export const ordersRouter = new Hono<AppEnv>()
  /**
   * For the Receiving page: vendor orders with items still on the way (oldest first), and orders
   * fully received in the last two weeks (newest first), each with its lines and who received what.
   */
  .get("/receiving", requireAuth, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    // Lines on a placed order. The orders and receipts below are picked by subquery, not by a list
    // of ids: a team's history has far more lines than D1 binds in one statement (lib/chunks.ts).
    const onOrder = and(
      isNotNull(orderRequests.orderId),
      inArray(orderRequests.status, ["ordered", "received"]),
    );
    const lines = await db.select().from(orderRequests).where(onOrder).all();
    if (lines.length === 0) return c.json({ open: [], recent: [] });
    const [orders, receipts] = await Promise.all([
      db
        .select()
        .from(vendorOrders)
        .where(
          inArray(
            vendorOrders.id,
            db.select({ id: orderRequests.orderId }).from(orderRequests).where(onOrder),
          ),
        )
        .all(),
      db
        .select()
        .from(requestEvents)
        .where(
          and(
            eq(requestEvents.action, "received"),
            inArray(
              requestEvents.requestId,
              db.select({ id: orderRequests.id }).from(orderRequests).where(onOrder),
            ),
          ),
        )
        .orderBy(desc(requestEvents.createdAt))
        .all(),
    ]);
    const receipt = new Map<number, { at: number; by: string }>();
    for (const e of receipts)
      if (!receipt.has(e.requestId)) receipt.set(e.requestId, { at: e.createdAt, by: e.userName });

    const shaped = orders.map((o) => {
      const mine = lines
        .filter((l) => l.orderId === o.id)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((l) => ({
          id: l.id,
          title: l.title,
          variant: l.variant,
          sku: l.sku,
          url: l.url,
          quantity: l.quantity,
          status: l.status as "ordered" | "received",
          requesterId: l.requesterId,
          requesterName: l.requesterName,
          receivedAt: receipt.get(l.id)?.at ?? null,
          receivedBy: receipt.get(l.id)?.by ?? null,
        }));
      const waiting = mine.filter((l) => l.status === "ordered").length;
      const lastReceived = Math.max(0, ...mine.map((l) => l.receivedAt ?? 0));
      return {
        id: o.id,
        vendor: o.vendor,
        placedAt: o.placedAt,
        placedByName: o.placedByName,
        tracking: o.tracking,
        waiting,
        lastReceived,
        lines: mine,
      };
    });
    const since = Date.now() - RECENT_DAYS * 86_400_000;
    return c.json({
      open: shaped.filter((o) => o.waiting > 0).sort((a, b) => a.placedAt - b.placedAt),
      recent: shaped
        .filter((o) => o.waiting === 0 && o.lastReceived >= since)
        .sort((a, b) => b.lastReceived - a.lastReceived),
    });
  })
  /**
   * Marks ordered items received. Mentors can receive anything; others only what they requested.
   * Items not on order (or not yours) are skipped and reported.
   */
  .post("/receive", requireAuth, receiveValidator, async (c) => {
    const { ids } = c.req.valid("json");
    const db = createOrdersDb(c.env.ORDERS_DB);
    const isMentor = hasMentorAccess(c);
    const userId = c.get("userId");
    const rows = await inChunks(ids, (chunk) =>
      db
        .select({
          id: orderRequests.id,
          requesterId: orderRequests.requesterId,
          status: orderRequests.status,
        })
        .from(orderRequests)
        .where(inArray(orderRequests.id, chunk))
        .all(),
    );
    const allowed = rows
      .filter((r) => r.status === "ordered" && (isMentor || r.requesterId === userId))
      .map((r) => r.id);
    if (allowed.length === 0)
      return c.json({ error: "None of those items are on order and yours to receive." }, 409);
    const now = Date.now();
    const received = await inChunks(allowed, (chunk) =>
      db
        .update(orderRequests)
        .set({ status: "received", updatedAt: now })
        .where(and(inArray(orderRequests.id, chunk), eq(orderRequests.status, "ordered")))
        .returning({ id: orderRequests.id })
        .all(),
    );
    for (let i = 0; i < received.length; i += 15) {
      await db.insert(requestEvents).values(
        received.slice(i, i + 15).map((r) => ({
          requestId: r.id,
          userId,
          userName: c.get("userDisplayName"),
          action: "received",
          note: null,
          createdAt: now,
        })),
      );
    }
    const done = received.map((r) => r.id);
    return c.json({ received: done, skipped: ids.filter((id) => !done.includes(id)) });
  })
  /** Sets or clears a placed order's tracking number. */
  .patch("/:id/tracking", requireMentor, trackingValidator, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const row = await db
      .update(vendorOrders)
      .set({ tracking: c.req.valid("json").tracking })
      .where(eq(vendorOrders.id, Number(c.req.param("id"))))
      .returning()
      .get();
    if (!row) return c.json({ error: "Order not found." }, 404);
    return c.json({ id: row.id, tracking: row.tracking });
  })
  /**
   * Imports the order sheet (CSV, same columns as the export) so past orders and spending show
   * up. Body: the CSV text. `?dryRun=1` returns the summary without saving anything; rows
   * imported before are skipped either way.
   */
  .post(
    "/import",
    requireMentor,
    validator("query", (value) => ({ dryRun: value.dryRun === "1" ? ("1" as const) : undefined })),
    async (c) => {
      const text = await c.req.text();
      if (!text.trim()) return c.json({ error: "Upload the order sheet as a .csv file." }, 400);
      if (text.length > 5_000_000)
        return c.json({ error: "That file is too large (5 MB max)." }, 400);
      const result = await importSheet(
        createOrdersDb(c.env.ORDERS_DB),
        text,
        c.req.valid("query").dryRun === "1",
      );
      if (typeof result === "string") return c.json({ error: result }, 400);
      return c.json(result);
    },
  )
  /**
   * Places an order with one vendor: the given approved requests become ordered at the final
   * quantity and price entered here, with the order's shipping and tax. Only these numbers count
   * against budgets. Lines no longer approved are skipped and reported.
   */
  .post("/", requireMentor, placeValidator, async (c) => {
    const body = c.req.valid("json");
    const db = createOrdersDb(c.env.ORDERS_DB);
    const ids = body.lines.map((l) => l.requestId);
    const approved = await inChunks(ids, (chunk) =>
      db
        .select()
        .from(orderRequests)
        .where(and(inArray(orderRequests.id, chunk), eq(orderRequests.status, "approved")))
        .all(),
    );
    if (approved.length === 0) {
      return c.json(
        { error: "None of those requests are approved and waiting to be ordered." },
        409,
      );
    }

    const now = Date.now();
    const order = await db
      .insert(vendorOrders)
      .values({
        vendor: body.vendor,
        placedById: c.get("userId"),
        placedByName: c.get("userDisplayName"),
        shippingCents: body.shippingCents,
        taxCents: body.taxCents,
        tracking: body.tracking,
        placedAt: now,
      })
      .returning()
      .get();

    const byId = new Map(approved.map((r) => [r.id, r]));
    const lines = body.lines.filter((l) => byId.has(l.requestId));
    const statements = [];
    for (const line of lines) {
      statements.push(
        db
          .update(orderRequests)
          .set({
            status: "ordered",
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            lineTotalCents: null,
            orderId: order.id,
            updatedAt: now,
          })
          // Still conditional on being approved, in case it was cancelled a moment ago.
          .where(and(eq(orderRequests.id, line.requestId), eq(orderRequests.status, "approved"))),
      );
    }
    // The order's fees as charged to each category (split by item cost), stored with the order.
    const fees = [
      ...chargesByCategory(
        lines.map((l) => ({
          ...l,
          categoryId: (byId.get(l.requestId) as (typeof approved)[number]).categoryId,
        })),
        body.shippingCents,
        body.taxCents,
      ),
    ].flatMap(([categoryId, c]) => [
      { orderId: order.id, kind: "Shipping", categoryId, cents: c.shipping },
      { orderId: order.id, kind: "Tax", categoryId, cents: c.tax },
    ]);
    for (let i = 0; i < fees.length; i += 20) {
      statements.push(db.insert(orderCharges).values(fees.slice(i, i + 20)));
    }
    // D1 caps bound parameters at 100 per statement; events have 6 columns.
    for (let i = 0; i < lines.length; i += 15) {
      statements.push(
        db.insert(requestEvents).values(
          lines.slice(i, i + 15).map((line) => {
            const changes = describeChanges(
              byId.get(line.requestId) as (typeof approved)[number],
              line,
            );
            return {
              requestId: line.requestId,
              userId: c.get("userId"),
              userName: c.get("userDisplayName"),
              action: "ordered",
              note: `Placed in ${body.vendor} order #${order.id}.${changes ? ` Changed ${changes}.` : ""}`,
              createdAt: now,
            };
          }),
        ),
      );
    }
    const [first, ...rest] = statements;
    if (first) await db.batch([first, ...rest]);
    // What we paid becomes the catalog price (good for 7 days before it's looked up again).
    await recordPrices(
      db,
      lines.map((l) => ({
        catalogItemId: (byId.get(l.requestId) as (typeof approved)[number]).catalogItemId,
        unitPriceCents: l.unitPriceCents,
      })),
      now,
    );

    return c.json({
      orderId: order.id,
      ordered: lines.map((l) => l.requestId),
      skipped: ids.filter((id) => !byId.has(id)),
    });
  })
  /**
   * The purchasing spreadsheet: every placed order (its lines, then Shipping and Tax rows per
   * budget category, split by cost), oldest first, then approved lines not ordered yet. Same
   * columns as the team's order sheet.
   */
  .get(
    "/export.csv",
    requireMentor,
    validator("query", (value, c): { fy?: string } => {
      if (value.fy !== undefined && !/^\d{4}$/.test(String(value.fy))) {
        return c.json({ error: "fy must be a year like 2026." }, 400) as never;
      }
      return { fy: value.fy as string | undefined };
    }),
    async (c) => {
      const db = createOrdersDb(c.env.ORDERS_DB);
      const current = fiscalYearOf(Date.now());
      const fy = Number(c.req.valid("query").fy ?? current);
      const [from, to] = fiscalRange(fy);
      const [orders, requests, categories, receipts, charges] = await Promise.all([
        db
          .select()
          .from(vendorOrders)
          .where(and(gte(vendorOrders.placedAt, from), lt(vendorOrders.placedAt, to)))
          .orderBy(asc(vendorOrders.placedAt))
          .all(),
        db
          .select()
          .from(orderRequests)
          .where(inArray(orderRequests.status, ["approved", "ordered", "received"]))
          .orderBy(asc(orderRequests.id))
          .all(),
        db.select().from(budgetCategories).all(),
        db
          .select()
          .from(requestEvents)
          .where(eq(requestEvents.action, "received"))
          .orderBy(desc(requestEvents.createdAt))
          .all(),
        db.select().from(orderCharges).all(),
      ]);
      const catLabel = new Map(categories.map((cat) => [cat.id, cat.code?.trim() || cat.name]));
      const received = new Map<number, { at: number; by: string }>();
      for (const e of receipts) {
        if (!received.has(e.requestId))
          received.set(e.requestId, { at: e.createdAt, by: e.userName });
      }

      const rows = [csvRow(CSV_HEADER)];
      for (const order of orders) {
        const lines = requests.filter((r) => r.orderId === order.id);
        if (lines.length === 0) continue;
        const placed = [csvDate(order.placedAt), order.placedByName, order.tracking];
        for (const r of lines) {
          const got = received.get(r.id);
          rows.push(
            csvRow([
              r.variant ? `${r.title} (${r.variant})` : r.title,
              order.vendor,
              r.sku,
              csvMoney(r.unitPriceCents),
              r.quantity,
              r.url,
              catLabel.get(r.categoryId),
              csvMoney(lineTotal(r)),
              r.reason,
              ...placed,
              csvDate(got?.at),
              got?.by,
            ]),
          );
        }
        // The order counts as received once every line is; the latest receipt dates it.
        const gots = lines.map((r) => received.get(r.id));
        const last = gots.every(Boolean)
          ? gots.reduce((a, b) => ((b?.at ?? 0) > (a?.at ?? 0) ? b : a))
          : undefined;
        // Fee rows (Shipping, Tax, Tariff, ...) per category, in a stable order.
        const KIND_ORDER = ["Shipping", "Tariff", "Tax"];
        const fees = orderFees(
          order,
          lines,
          charges.filter((ch) => ch.orderId === order.id),
        ).sort(
          (a, b) =>
            (KIND_ORDER.indexOf(a.kind) + 1 || 99) - (KIND_ORDER.indexOf(b.kind) + 1 || 99) ||
            a.categoryId - b.categoryId,
        );
        for (const fee of fees) {
          rows.push(
            csvRow([
              fee.kind,
              order.vendor,
              null,
              csvMoney(fee.cents),
              1,
              null,
              catLabel.get(fee.categoryId),
              csvMoney(fee.cents),
              null,
              ...placed,
              csvDate(last?.at),
              last?.by,
            ]),
          );
        }
      }
      // Approved but not ordered yet (only in the current year's sheet): estimates, no order details.
      for (const r of requests.filter((r) => r.status === "approved" && fy === current)) {
        rows.push(
          csvRow([
            r.variant ? `${r.title} (${r.variant})` : r.title,
            r.vendor,
            r.sku,
            csvMoney(r.unitPriceCents),
            r.quantity,
            r.url,
            catLabel.get(r.categoryId),
            csvMoney(lineTotal(r)),
            r.reason,
            // Not ordered: no order date, orderer, tracking or receipt.
            null,
            null,
            null,
            null,
            null,
          ]),
        );
      }

      return c.body(`${rows.join("\r\n")}\r\n`, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="g3-orders-${fiscalLabel(fy).replace("–", "-")}.csv"`,
      });
    },
  );
