import { inTeam, withTeam } from "@g3/auth";
import { DEMO_PEOPLE, DEMO_STUDENTS, type DemoPerson, SAFE_TEXT, vocabularyOf } from "@g3/demo";
import { asc, eq } from "drizzle-orm";
import type { OrdersDb } from "./db";
import {
  budgetCategories,
  catalogItems,
  categoryBudgets,
  orderCharges,
  orderRequests,
  partListItems,
  partLists,
  requestEvents,
  vendorOrders,
  vendors,
} from "./db/schema";
import { fiscalYearOf } from "./lib/fiscal";
import { DEFAULTS } from "./lib/settings";
import { STARTER_TEAM, ensureCatalog, forgetCatalog } from "./lib/starter";

// The public demo's sample data (roadmap 5.3), loaded after its nightly reset: budgets, vendors,
// and requests for real catalog parts in every status, two lists and a placed order on its way.
// Every text is from @g3/demo's safe lists or the starter catalog, so visitors can send it back.

const DAY = 24 * 60 * 60 * 1000;
const person = (n: number): DemoPerson => DEMO_PEOPLE[n - 1] as DemoPerson;
const mentor = person(2);

const CATEGORIES = [
  { name: "Drivetrain", code: "4101", budget: 300_000 },
  { name: "Electrical", code: "4102", budget: 200_000 },
  { name: "Hardware", code: "4200", budget: 150_000 },
  { name: "Tools", code: "4300", budget: 100_000 },
] as const;

/** Each request's status, priority and when it was made (days ago), in the order they're made. */
const REQUESTS: { status: string; priority: string; daysAgo: number; needIn?: number }[] = [
  { status: "requested", priority: "blocking", daysAgo: 1, needIn: 5 },
  { status: "requested", priority: "high", daysAgo: 2, needIn: 10 },
  { status: "requested", priority: "normal", daysAgo: 3 },
  { status: "requested", priority: "nice", daysAgo: 4 },
  { status: "approved", priority: "high", daysAgo: 6, needIn: 8 },
  { status: "approved", priority: "normal", daysAgo: 7 },
  { status: "approved", priority: "normal", daysAgo: 8 },
  { status: "ordered", priority: "high", daysAgo: 12 },
  { status: "ordered", priority: "normal", daysAgo: 12 },
  { status: "ordered", priority: "normal", daysAgo: 13 },
  { status: "received", priority: "normal", daysAgo: 25 },
  { status: "received", priority: "high", daysAgo: 26 },
  { status: "received", priority: "normal", daysAgo: 27 },
  { status: "denied", priority: "nice", daysAgo: 9 },
  { status: "cancelled", priority: "normal", daysAgo: 10 },
  { status: "wishlist", priority: "nice", daysAgo: 15 },
  { status: "wishlist", priority: "nice", daysAgo: 16 },
];

/** A calendar day `days` from `now`, stored as 16:00 UTC that day (like need-by dates). */
const day = (now: number, days: number) => {
  const at = new Date(now + days * DAY);
  at.setUTCHours(16, 0, 0, 0);
  return at.getTime();
};

/** Loads the demo team's Orders: its catalog copy first, then everything else. */
export async function loadDemo(db: OrdersDb, teamId: string) {
  forgetCatalog(teamId);
  await ensureCatalog(db, teamId);
  const now = Date.now();
  const year = fiscalYearOf(now, { startMonth: DEFAULTS.fiscalYearStart, timeZone: "UTC" });

  const categoryIds: number[] = [];
  for (const category of CATEGORIES) {
    const [row] = await db
      .insert(budgetCategories)
      .values(
        withTeam(teamId, {
          name: category.name,
          code: category.code,
          budgetCents: category.budget,
          createdAt: now - 60 * DAY,
        }),
      )
      .returning({ id: budgetCategories.id });
    categoryIds.push(row.id);
    await db
      .insert(categoryBudgets)
      .values(
        withTeam(teamId, { categoryId: row.id, fiscalYear: year, budgetCents: category.budget }),
      );
  }

  // Parts from the team's catalog copy, spread across it.
  const parts = await db
    .select()
    .from(catalogItems)
    .where(inTeam(catalogItems, teamId, eq(catalogItems.linkKind, "product")))
    .orderBy(asc(catalogItems.id))
    .limit(600)
    .all();
  const step = Math.max(1, Math.floor(parts.length / REQUESTS.length));
  const picked = REQUESTS.map((_, i) => parts[(i * step) % Math.max(parts.length, 1)]);

  for (const name of new Set(picked.map((part) => part?.vendor).filter(Boolean))) {
    await db.insert(vendors).values(
      withTeam(teamId, {
        key: String(name).toLowerCase(),
        name: String(name),
        leadTimeDays: 2,
        shippingDays: 4,
        freeShippingCents: 20_000,
        updatedAt: now,
      }),
    );
  }

  // One placed order, on its way, for the "ordered" lines.
  const [order] = await db
    .insert(vendorOrders)
    .values(
      withTeam(teamId, {
        vendor: picked[7]?.vendor ?? "WCP",
        placedById: mentor.id,
        placedByName: mentor.name,
        shippingCents: 1_299,
        tracking: SAFE_TEXT.tracking[0],
        placedAt: now - 3 * DAY,
      }),
    )
    .returning({ id: vendorOrders.id });
  await db.insert(orderCharges).values(
    withTeam(teamId, {
      orderId: order.id,
      kind: "Shipping",
      categoryId: categoryIds[0],
      cents: 1_299,
    }),
  );

  const requestIds: number[] = [];
  for (const [i, plan] of REQUESTS.entries()) {
    const part = picked[i];
    if (!part) continue;
    const requester = DEMO_STUDENTS[i % DEMO_STUDENTS.length] as DemoPerson;
    const createdAt = now - plan.daysAgo * DAY;
    const [row] = await db
      .insert(orderRequests)
      .values(
        withTeam(teamId, {
          requesterId: requester.id,
          requesterName: requester.name,
          url: part.url,
          vendor: part.vendor,
          title: part.name,
          sku: part.sku,
          image: part.image,
          unitPriceCents: 899 + ((i * 731) % 6_000),
          quantity: 1 + (i % 4),
          packQuantity: part.packQuantity,
          categoryId: categoryIds[i % categoryIds.length] as number,
          reason: SAFE_TEXT.reason[i % SAFE_TEXT.reason.length] as string,
          status: plan.status as (typeof orderRequests.$inferInsert)["status"],
          priority: plan.priority as (typeof orderRequests.$inferInsert)["priority"],
          needBy: plan.needIn === undefined ? null : day(now, plan.needIn),
          orderId: plan.status === "ordered" ? order.id : null,
          storePlatform: part.storePlatform,
          storeVariantId: part.storeVariantId,
          catalogItemId: part.id,
          createdAt,
          updatedAt: createdAt,
        }),
      )
      .returning({ id: orderRequests.id });
    requestIds.push(row.id);
    const events = [
      { userId: requester.id, userName: requester.name, action: "created", at: createdAt },
    ];
    if (plan.status !== "requested" && plan.status !== "wishlist") {
      events.push({
        userId: mentor.id,
        userName: mentor.name,
        action: plan.status,
        at: createdAt + DAY,
      });
    }
    for (const event of events) {
      await db.insert(requestEvents).values(
        withTeam(teamId, {
          requestId: row.id,
          userId: event.userId,
          userName: event.userName,
          action: event.action,
          note: event.action === "denied" ? SAFE_TEXT.note[3] : null,
          createdAt: event.at,
        }),
      );
    }
  }

  const lists = [
    { name: SAFE_TEXT.title[0], requests: requestIds.slice(0, 5) },
    { name: SAFE_TEXT.title[5], requests: requestIds.slice(8, 12) },
  ];
  for (const list of lists) {
    const [row] = await db
      .insert(partLists)
      .values(
        withTeam(teamId, {
          name: list.name,
          description: SAFE_TEXT.note[2],
          createdById: mentor.id,
          createdByName: mentor.name,
          createdAt: now - 20 * DAY,
          updatedAt: now - 20 * DAY,
        }),
      )
      .returning({ id: partLists.id });
    for (const requestId of list.requests) {
      await db.insert(partListItems).values(
        withTeam(teamId, {
          listId: row.id,
          requestId,
          addedByName: mentor.name,
          addedAt: now - 20 * DAY,
        }),
      );
    }
  }
  return { requests: requestIds.length };
}

let words: string[] | null = null;

/**
 * The words in the demo's Orders data, for the gateway: the starter catalog (every part a visitor
 * can request) and the vendors' names. Everything else in it is from @g3/demo's lists.
 */
export async function demoWords(db: OrdersDb): Promise<string[]> {
  if (words) return words;
  const parts = await db
    .select({
      category: catalogItems.category,
      name: catalogItems.name,
      vendor: catalogItems.vendor,
      sku: catalogItems.sku,
      options: catalogItems.options,
      url: catalogItems.url,
      image: catalogItems.image,
    })
    .from(catalogItems)
    .where(inTeam(catalogItems, STARTER_TEAM))
    .all();
  words = vocabularyOf(parts, CATEGORIES);
  return words;
}
