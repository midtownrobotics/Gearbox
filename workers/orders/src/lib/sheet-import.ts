import { inArray, isNotNull } from "drizzle-orm";
import type { OrdersDb } from "../db";
import {
  budgetCategories,
  orderCharges,
  orderRequests,
  requestEvents,
  vendorOrders,
} from "../db/schema";
import { parseCsv } from "./csv";
import { vendorName } from "./vendors";

// Imports the team's purchasing spreadsheet (the format /orders/export.csv writes). Consecutive
// rows with the same supplier, order date and orderer form one vendor order; Shipping / Tax /
// Tariff rows are that order's fees, kept on the categories the sheet charged them to.

const IMPORT_USER = "import";
const FEE_KINDS: Record<string, string> = {
  shipping: "Shipping",
  tax: "Tax",
  tariff: "Tariff",
  tariffs: "Tariff",
  fee: "Fees",
  fees: "Fees",
  handling: "Handling",
};

/** Header names (lowercase letters only), with the spellings both the export and the original sheet use. */
const COLUMNS = {
  part: ["part"],
  supplier: ["supplier"],
  sku: ["partnumbersku", "sku"],
  unit: ["unitcost"],
  quantity: ["quantity"],
  link: ["link"],
  category: ["budgetcategory", "budgetcat"],
  total: ["totalcost"],
  notes: ["notes"],
  placedAt: ["orderplaceddate"],
  placedBy: ["placedby"],
  tracking: ["tracking"],
  receivedAt: ["packagereceived"],
  receivedBy: ["receivedby"],
} as const;

type SheetLine = {
  row: number;
  title: string;
  vendor: string;
  sku: string | null;
  quantity: number;
  unitPriceCents: number | null;
  totalCents: number;
  url: string;
  reason: string;
  category: string;
  receivedAt: number | null;
  receivedBy: string | null;
  key: string;
};
type SheetFee = { kind: string; category: string; cents: number };
type SheetOrder = {
  vendor: string;
  placedAt: number;
  placedBy: string;
  tracking: string | null;
  lines: SheetLine[];
  fees: SheetFee[];
};
export type SheetPlan = { orders: SheetOrder[]; unplaced: SheetLine[]; warnings: string[] };

/** Removes invisible characters (left-to-right marks, zero-width spaces) and extra whitespace. */
const clean = (s: string | undefined) => (s ?? "").replace(/[​-‏‪-‮⁠﻿]/g, "").replace(/\s+/g, " ").trim();

function money(s: string): number | null {
  const v = clean(s).replace(/[$,\s]/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** M/D/YYYY → midday Eastern that day (so the date never shifts in any US time zone). */
function sheetDate(s: string): number | null {
  const m = clean(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  return Date.UTC(year, Number(m[1]) - 1, Number(m[2]), 16);
}

function isUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Reads the sheet into orders (placed) and lines not placed yet, with warnings for odd rows. */
export function planSheet(text: string): SheetPlan | string {
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map((h) =>
    clean(h)
      .toLowerCase()
      .replace(/[^a-z]/g, ""),
  );
  const col: Partial<Record<keyof typeof COLUMNS, number>> = {};
  for (const [key, names] of Object.entries(COLUMNS)) {
    const i = header.findIndex((h) => (names as readonly string[]).includes(h));
    if (i !== -1) col[key as keyof typeof COLUMNS] = i;
  }
  const missing = (["part", "supplier", "quantity", "category"] as const).filter(
    (k) => col[k] === undefined,
  );
  if (missing.length || (col.unit === undefined && col.total === undefined)) {
    return "That doesn't look like the order sheet: it needs Part, Supplier, Quantity, Budget Category and Unit Cost or Total Cost columns.";
  }

  const warnings: string[] = [];
  const orders: (SheetOrder & { groupKey: string })[] = [];
  const unplaced: SheetLine[] = [];
  const seen = new Map<string, number>();
  let current: (SheetOrder & { groupKey: string }) | null = null;
  let ignoredFees = 0;

  rows.slice(1).forEach((cells, index) => {
    const row = index + 2;
    const get = (k: keyof typeof COLUMNS) =>
      clean(col[k] === undefined ? "" : cells[col[k] as number]);
    const part = get("part");
    if (!part) return; // blank or totals-only rows
    const vendor = vendorName(get("supplier")) || "Unknown vendor";
    const category = get("category") || "Uncategorized";
    const placedAt = sheetDate(get("placedAt"));
    const placedBy = get("placedBy") || "Order sheet";
    const quantity = Number.parseInt(get("quantity"), 10) || 1;
    const unit = money(get("unit"));
    const total = money(get("total")) ?? (unit === null ? 0 : unit * quantity);

    const feeKind = FEE_KINDS[part.toLowerCase()];
    if (feeKind) {
      if (placedAt === null || !current) {
        if (total) ignoredFees++;
        return;
      }
      current.fees.push({ kind: feeKind, category, cents: total });
      return;
    }

    const link = get("link");
    const notes = get("notes");
    const sku = get("sku") || null;
    // Identical rows can repeat (the same part bought twice); the occurrence keeps keys unique.
    const base = [vendor, placedAt ?? "", part, sku ?? "", quantity, total].join("|");
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    const line: SheetLine = {
      row,
      title: part.slice(0, 300),
      vendor,
      sku: sku?.slice(0, 100) ?? null,
      quantity,
      unitPriceCents: unit ?? (quantity ? Math.round(total / quantity) : null),
      totalCents: total,
      url: isUrl(link) ? link : "",
      reason:
        [notes, link && !isUrl(link) ? `Link from sheet: ${link}` : null]
          .filter(Boolean)
          .join(" — ")
          .slice(0, 1000) || "Imported from the order sheet.",
      category,
      receivedAt: sheetDate(get("receivedAt")),
      receivedBy: get("receivedBy") || null,
      key: `${base}|${occurrence}`,
    };
    if (link && !isUrl(link))
      warnings.push(`Row ${row}: the link isn't a URL, so it was kept in the notes.`);

    if (placedAt === null) {
      unplaced.push(line);
      current = null;
      return;
    }
    const groupKey = [vendor.toLowerCase(), placedAt, placedBy].join("|");
    if (!current || current.groupKey !== groupKey) {
      current = { groupKey, vendor, placedAt, placedBy, tracking: null, lines: [], fees: [] };
      orders.push(current);
    }
    current.tracking ??= get("tracking") || null;
    current.lines.push(line);
  });
  if (ignoredFees) {
    warnings.push(
      `${ignoredFees} shipping/tax row(s) for orders that aren't placed yet were skipped.`,
    );
  }
  return { orders: orders.map(({ groupKey, ...o }) => o), unplaced, warnings };
}

async function fingerprint(key: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type CategoryMatch = {
  label: string;
  id: number | null;
  name: string;
  action: "existing" | "set code" | "create";
};

/** Matches a sheet's Budget Category ("4101") to a category: by code, by name, or by the code in the name. */
function matchCategory(
  label: string,
  categories: { id: number; name: string; code: string | null }[],
): CategoryMatch {
  const byCode = categories.find((c) => c.code?.trim() === label);
  if (byCode) return { label, id: byCode.id, name: byCode.name, action: "existing" };
  const byName = categories.find((c) => c.name.trim().toLowerCase() === label.toLowerCase());
  if (byName) return { label, id: byName.id, name: byName.name, action: "existing" };
  if (/^\d+$/.test(label)) {
    const inName = categories.find((c) => new RegExp(`(^|\\D)${label}(\\D|$)`).test(c.name));
    if (inName)
      return {
        label,
        id: inName.id,
        name: inName.name,
        action: inName.code ? "existing" : "set code",
      };
  }
  return { label, id: null, name: label, action: "create" };
}

export type ImportSummary = {
  orders: number;
  lines: number;
  notOrdered: number;
  alreadyImported: number;
  spentCents: number;
  categories: { label: string; name: string; action: CategoryMatch["action"]; cents: number }[];
  warnings: string[];
};

/** Plans (and unless `dryRun`, performs) the import. Rows imported before are skipped. */
export async function importSheet(
  db: OrdersDb,
  text: string,
  dryRun: boolean,
): Promise<ImportSummary | string> {
  const plan = planSheet(text);
  if (typeof plan === "string") return plan;

  // Skip rows already imported. A placed order is skipped whole if any of its rows exist.
  const allLines = [...plan.orders.flatMap((o) => o.lines), ...plan.unplaced];
  const keys = new Map<SheetLine, string>();
  for (const line of allLines) keys.set(line, await fingerprint(line.key));
  const existing = new Set(
    (
      await db
        .select({ key: orderRequests.importKey })
        .from(orderRequests)
        .where(isNotNull(orderRequests.importKey))
        .all()
    ).map((r) => r.key),
  );
  const isNew = (l: SheetLine) => !existing.has(keys.get(l) as string);
  const orders = plan.orders.filter((o) => o.lines.every(isNew));
  const unplaced = plan.unplaced.filter(isNew);
  const alreadyImported =
    allLines.length - orders.reduce((n, o) => n + o.lines.length, 0) - unplaced.length;

  const categories = await db
    .select({ id: budgetCategories.id, name: budgetCategories.name, code: budgetCategories.code })
    .from(budgetCategories)
    .all();
  const labels = new Set([
    ...orders.flatMap((o) => [...o.lines.map((l) => l.category), ...o.fees.map((f) => f.category)]),
    ...unplaced.map((l) => l.category),
  ]);
  const matches = new Map([...labels].map((label) => [label, matchCategory(label, categories)]));

  const spentBy = new Map<string, number>();
  for (const o of orders) {
    for (const l of o.lines) spentBy.set(l.category, (spentBy.get(l.category) ?? 0) + l.totalCents);
    for (const f of o.fees) spentBy.set(f.category, (spentBy.get(f.category) ?? 0) + f.cents);
  }
  const summary: ImportSummary = {
    orders: orders.length,
    lines: orders.reduce((n, o) => n + o.lines.length, 0),
    notOrdered: unplaced.length,
    alreadyImported,
    spentCents: [...spentBy.values()].reduce((a, b) => a + b, 0),
    categories: [...matches.values()].map((m) => ({
      label: m.label,
      name: m.name,
      action: m.action,
      cents: spentBy.get(m.label) ?? 0,
    })),
    warnings: plan.warnings,
  };
  if (dryRun || (orders.length === 0 && unplaced.length === 0)) return summary;

  // Categories: create missing ones, and record the code on ones matched by the code in their name.
  const now = Date.now();
  const categoryId = new Map<string, number>();
  for (const m of matches.values()) {
    if (m.action === "create") {
      const created = await db
        .insert(budgetCategories)
        .values({ name: m.label, code: /^\d+$/.test(m.label) ? m.label : null, createdAt: now })
        .returning({ id: budgetCategories.id })
        .get();
      categoryId.set(m.label, created.id);
    } else {
      if (m.action === "set code") {
        await db
          .update(budgetCategories)
          .set({ code: m.label })
          .where(inArray(budgetCategories.id, [m.id as number]));
      }
      categoryId.set(m.label, m.id as number);
    }
  }

  const events: (typeof requestEvents.$inferInsert)[] = [];
  const insertLines = async (
    lines: SheetLine[],
    order: { id: number; placedAt: number; placedBy: string } | null,
  ) => {
    const values = lines.map((l) => {
      const status = order === null ? "approved" : l.receivedAt !== null ? "received" : "ordered";
      return {
        requesterId: IMPORT_USER,
        requesterName: order?.placedBy ?? "Order sheet",
        url: l.url,
        vendor: l.vendor,
        title: l.title,
        sku: l.sku,
        unitPriceCents: l.unitPriceCents,
        currency: "USD",
        quantity: l.quantity,
        categoryId: categoryId.get(l.category) as number,
        reason: l.reason,
        status: status as "approved" | "ordered" | "received",
        lineTotalCents:
          l.unitPriceCents !== null && l.unitPriceCents * l.quantity === l.totalCents
            ? null
            : l.totalCents,
        orderId: order?.id ?? null,
        importKey: keys.get(l) as string,
        createdAt: order?.placedAt ?? now,
        updatedAt: now,
      };
    });
    // ~20 columns per row: 4 rows per statement stays under D1's 100 bound parameters.
    for (let i = 0; i < values.length; i += 4) {
      const chunk = values.slice(i, i + 4);
      const ids = await db
        .insert(orderRequests)
        .values(chunk)
        .returning({ id: orderRequests.id, key: orderRequests.importKey })
        .all();
      for (const { id, key } of ids) {
        const line = lines.find((l) => keys.get(l) === key) as SheetLine;
        const at = order?.placedAt ?? now;
        events.push({
          requestId: id,
          userId: IMPORT_USER,
          userName: "Order sheet import",
          action: "created",
          note: `Imported from row ${line.row} of the order sheet.`,
          createdAt: at,
        });
        if (order) {
          events.push({
            requestId: id,
            userId: IMPORT_USER,
            userName: order.placedBy,
            action: "ordered",
            note: null,
            createdAt: order.placedAt,
          });
        } else {
          events.push({
            requestId: id,
            userId: IMPORT_USER,
            userName: "Order sheet import",
            action: "approved",
            note: null,
            createdAt: at,
          });
        }
        if (order && line.receivedAt !== null) {
          events.push({
            requestId: id,
            userId: IMPORT_USER,
            userName: line.receivedBy ?? "Order sheet",
            action: "received",
            note: null,
            createdAt: line.receivedAt,
          });
        }
      }
    }
  };

  for (const o of orders) {
    const fee = (kind: string) =>
      o.fees.filter((f) => f.kind === kind).reduce((n, f) => n + f.cents, 0);
    const order = await db
      .insert(vendorOrders)
      .values({
        vendor: o.vendor,
        placedById: IMPORT_USER,
        placedByName: o.placedBy,
        shippingCents: fee("Shipping"),
        taxCents: fee("Tax"),
        tracking: o.tracking,
        placedAt: o.placedAt,
      })
      .returning({ id: vendorOrders.id })
      .get();
    if (o.fees.length) {
      await db.insert(orderCharges).values(
        o.fees.map((f) => ({
          orderId: order.id,
          kind: f.kind,
          categoryId: categoryId.get(f.category) as number,
          cents: f.cents,
        })),
      );
    }
    await insertLines(o.lines, { id: order.id, placedAt: o.placedAt, placedBy: o.placedBy });
  }
  if (unplaced.length) await insertLines(unplaced, null);
  for (let i = 0; i < events.length; i += 15) {
    await db.insert(requestEvents).values(events.slice(i, i + 15));
  }
  return summary;
}
