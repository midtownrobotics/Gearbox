import { env } from "cloudflare:test";
import { type Seeded, checkIsolation } from "@g3/testing/isolation";
import type { TeamUsers } from "@g3/testing/users";
import { jsonAs } from "@g3/testing/worker";
import { expect, it } from "vitest";
import { app } from "../src/index";

// Two teams, each with its own budget category and keyword rule, catalog category and part,
// requests (awaiting a mentor, approved, ordered), a placed order, a vendor profile with a credit,
// a list, a trusted student and a naming template. Every route, called as team A's admin, mentor,
// student and kiosk session with team B's ids, must show none of B's and change nothing of B's.
// Each team also has its own copy of the starter catalog, which A's edits mustn't reach either.

const database = (env as unknown as { ORDERS_DB: D1Database }).ORDERS_DB;
const TABLES = [
  "budget_categories",
  "vendor_orders",
  "order_charges",
  "category_budgets",
  "vendors",
  "vendor_credits",
  "order_requests",
  "request_events",
  "app_settings",
  "category_rules",
  "catalog_families",
  "catalog_items",
  "catalog_categories",
  "app_users",
  "part_lists",
  "part_list_items",
];
/** A vendor both teams have a profile for: A naming it changes A's profile, never B's. */
const SHARED_VENDOR = "WCP";

type Id = { id: number };

async function seed(team: TeamUsers): Promise<Seeded> {
  // Lowercase, so it's still found in lowercased vendor keys and keywords.
  const tag = `t${crypto.randomUUID().slice(0, 8)}`;
  const { student, mentor } = team;
  // Opening the app records the student and copies the starter catalog.
  await jsonAs(student, "/me");
  await jsonAs(mentor, "/settings", {
    method: "PUT",
    body: { namingTemplate: `{title} ${tag}` },
  });
  const category = await jsonAs<Id>(
    mentor,
    "/categories",
    { method: "POST", body: { name: `Budget ${tag}`, budgetCents: 10_000 } },
    201,
  );
  const rule = await jsonAs<Id>(
    mentor,
    "/category-rules",
    { method: "POST", body: { keyword: tag, categoryId: category.id } },
    201,
  );
  const catalogCategory = `Parts ${tag}`;
  await jsonAs(
    mentor,
    "/catalog/categories",
    { method: "POST", body: { name: catalogCategory } },
    201,
  );
  const part = await jsonAs<Id>(
    mentor,
    "/catalog/items",
    {
      method: "POST",
      body: {
        name: `Part ${tag}`,
        category: catalogCategory,
        vendor: `Vendor ${tag}`,
        url: `https://example.com/catalog/${tag}`,
      },
    },
    201,
  );
  const request = (n: number) =>
    jsonAs<Id>(
      student,
      "/requests",
      {
        method: "POST",
        body: {
          url: `https://example.com/products/${tag}-${n}`,
          vendor: SHARED_VENDOR,
          title: `Request ${n} ${tag}`,
          quantity: 1,
          unitPriceCents: 500,
          categoryId: category.id,
          reason: `Needed ${tag}`,
          catalogCategory,
        },
      },
      201,
    );
  const ordered = await request(1);
  const approved = await request(2);
  const waiting = await request(3);
  for (const { id } of [ordered, approved]) {
    await jsonAs(mentor, `/requests/${id}/approve`, { method: "POST", body: {} });
  }
  const order = await jsonAs<{ orderId: number }>(mentor, "/orders", {
    method: "POST",
    body: {
      vendor: SHARED_VENDOR,
      lines: [{ requestId: ordered.id, quantity: 1, unitPriceCents: 450 }],
      shippingCents: 100,
      tracking: `1Z${tag}`,
    },
  });
  await jsonAs(mentor, `/vendors/${SHARED_VENDOR}`, {
    method: "PUT",
    body: { notes: `Notes ${tag}`, defaultCategoryId: category.id },
  });
  const credit = await jsonAs<Id>(
    mentor,
    `/vendors/${SHARED_VENDOR}/credits`,
    { method: "POST", body: { kind: "voucher", label: `Credit ${tag}`, code: tag } },
    201,
  );
  const list = await jsonAs<Id>(
    student,
    "/lists",
    { method: "POST", body: { name: `List ${tag}` } },
    201,
  );
  await jsonAs(student, `/lists/${list.id}/items`, {
    method: "POST",
    body: { requestIds: [ordered.id, waiting.id] },
  });
  await jsonAs(mentor, `/trusted/${encodeURIComponent(student.id)}`, {
    method: "PUT",
    body: { trusted: true },
  });

  const ids: Record<string, string> = {
    requests: String(waiting.id),
    orders: String(order.orderId),
    categories: String(category.id),
    "category-rules": String(rule.id),
    lists: String(list.id),
    trusted: student.id,
  };
  return {
    params: (path, name) => {
      if (name === "action") return "approve";
      if (name === "requestId") return String(ordered.id);
      if (name === "key") return SHARED_VENDOR;
      if (path.startsWith("/vendors/credits/")) return String(credit.id);
      if (path.startsWith("/catalog/items/")) return String(part.id);
      return ids[path.split("/")[1]];
    },
    markers: [tag],
    data: {
      category: category.id,
      catalogCategory,
      part: part.id,
      ordered: ordered.id,
      approved: approved.id,
      waiting: waiting.id,
      list: list.id,
      tag,
    },
  };
}

async function snapshot(teamId: string) {
  const out: Record<string, unknown> = {};
  for (const table of TABLES) {
    const order = table === "app_settings" ? "key" : table === "app_users" ? "id" : "rowid";
    out[table] = (
      await database
        .prepare(`SELECT * FROM ${table} WHERE team_id = ? ORDER BY ${order}`)
        .bind(teamId)
        .all()
    ).results;
  }
  return out;
}

it("keeps every team's orders to itself", async () => {
  const starterBefore = await snapshot("starter");
  const { problems, requests } = await checkIsolation({
    app,
    seed,
    snapshot,
    // Opens Share-A-Cart's sign-in, which registers this app with share-a-cart.com over the
    // internet; it touches only the caller's team's settings (lib/share-a-cart.ts).
    skip: ["GET /share-a-cart/connect"],
    bodies: (b) => {
      const d = b.data as Record<string, number> & { catalogCategory: string; tag: string };
      return {
        "PUT /settings": { namingTemplate: "{title}" },
        "POST /requests": {
          url: "https://example.com/products/mine",
          title: "Mine",
          quantity: 1,
          categoryId: d.category,
          reason: "Using team B's category",
          catalogItemId: d.part,
        },
        "PATCH /requests/:id": { title: "Renamed", categoryId: d.category },
        "POST /requests/:id/:action": { note: "Approved by another team" },
        "POST /orders": {
          vendor: SHARED_VENDOR,
          lines: [{ requestId: d.approved, quantity: 1, unitPriceCents: 1 }],
        },
        "POST /orders/receive": { ids: [d.ordered] },
        "PATCH /orders/:id/tracking": { tracking: "changed" },
        "POST /categories": { name: "Mine", budgetCents: 1 },
        "PATCH /categories/:id": { name: "Renamed", budgetCents: 1 },
        "POST /category-rules": { keyword: "mine", categoryId: d.category },
        "PUT /vendors/:key": { notes: "Mine", defaultCategoryId: d.category },
        "POST /vendors/:key/credits": { kind: "credit", label: "Mine" },
        "PATCH /vendors/credits/:id": { label: "Changed" },
        "POST /suggest": { url: `https://example.com/products/${d.tag}-1`, title: "Anything" },
        // A starter category both teams have: A moving its parts moves only A's.
        "DELETE /catalog/categories": { name: "Bearings & Bushings", moveTo: "Control System" },
        "POST /catalog/items": {
          name: "Mine",
          category: d.catalogCategory,
          vendor: "Mine",
          url: "https://example.com/mine",
        },
        "PATCH /catalog/items/:id": { name: "Renamed" },
        "PUT /trusted/:id": { trusted: false },
        "POST /lists": { name: "Mine" },
        "PATCH /lists/:id": { name: "Renamed" },
        "POST /lists/:id/items": { requestIds: [d.waiting] },
        "POST /inventory/defaults": { ids: [d.ordered] },
        "POST /share-a-cart/carts": {
          vendor: "Amazon",
          lines: [{ requestId: d.approved, quantity: 1 }],
        },
      };
    },
  });
  expect(problems).toEqual([]);
  expect(requests).toBeGreaterThan(150);
  // Nobody's edits reached the starter catalog new teams copy.
  expect(await snapshot("starter")).toEqual(starterBefore);
}, 120_000);
