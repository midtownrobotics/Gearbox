import { inTeam, requireAuth, requireMentor, withTeam } from "@g3/auth";
import { asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type OrdersDb, createOrdersDb } from "../db";
import { budgetCategories, categoryBudgets, orderRequests, vendorOrders } from "../db/schema";
import { lineTotal, spentByCategory } from "../lib/accounting";
import { fiscalYearOf } from "../lib/fiscal";
import { localTimeZone } from "../lib/local-time";
import { teamCalendar } from "../lib/settings";
import type { AppEnv } from "../types";

type CategoryInput = {
  name?: string;
  code?: string | null;
  /** The budget for `fiscalYear` (default: the current one); null removes it. */
  budgetCents?: number | null;
  fiscalYear?: number;
  isArchived?: boolean;
};

const fyQuery = validator("query", (value, c): { fy?: string } => {
  if (value.fy !== undefined && !/^\d{4}$/.test(String(value.fy))) {
    return c.json({ error: "fy must be a year like 2026." }, 400) as never;
  }
  return { fy: value.fy as string | undefined };
});

/** Sets (or with null, removes) one of the team's category budgets for one fiscal year. */
async function setBudget(
  db: OrdersDb,
  teamId: string,
  categoryId: number,
  fiscalYear: number,
  cents: number | null,
) {
  if (cents === null) {
    await db
      .delete(categoryBudgets)
      .where(
        inTeam(
          categoryBudgets,
          teamId,
          eq(categoryBudgets.categoryId, categoryId),
          eq(categoryBudgets.fiscalYear, fiscalYear),
        ),
      );
    return;
  }
  await db
    .insert(categoryBudgets)
    .values(withTeam(teamId, { categoryId, fiscalYear, budgetCents: cents }))
    .onConflictDoUpdate({
      target: [categoryBudgets.categoryId, categoryBudgets.fiscalYear],
      set: { budgetCents: cents },
    });
}

const categoryValidator = (requireName: boolean) =>
  validator("json", (value, c): CategoryInput => {
    const v = (value ?? {}) as Record<string, unknown>;
    const out: CategoryInput = {};
    if (v.name !== undefined || requireName) {
      if (typeof v.name !== "string" || !v.name.trim() || v.name.trim().length > 60) {
        return c.json({ error: "name must be 1–60 characters." }, 400) as never;
      }
      out.name = v.name.trim();
    }
    if (v.budgetCents !== undefined) {
      if (
        v.budgetCents !== null &&
        !(Number.isInteger(v.budgetCents) && (v.budgetCents as number) >= 0)
      ) {
        return c.json(
          { error: "budgetCents must be a non-negative integer or null." },
          400,
        ) as never;
      }
      out.budgetCents = v.budgetCents as number | null;
    }
    if (v.code !== undefined) {
      if (v.code !== null && (typeof v.code !== "string" || v.code.trim().length > 20)) {
        return c.json({ error: "code must be up to 20 characters." }, 400) as never;
      }
      out.code = typeof v.code === "string" && v.code.trim() ? v.code.trim() : null;
    }
    if (v.fiscalYear !== undefined) {
      const fy = v.fiscalYear as number;
      if (!Number.isInteger(fy) || fy < 2000 || fy > 2100) {
        return c.json({ error: "fiscalYear must be a year like 2026." }, 400) as never;
      }
      out.fiscalYear = fy;
    }
    if (v.isArchived !== undefined) {
      if (typeof v.isArchived !== "boolean") {
        return c.json({ error: "isArchived must be a boolean." }, 400) as never;
      }
      out.isArchived = v.isArchived;
    }
    return out;
  });

export const categoriesRouter = new Hono<AppEnv>()
  /**
   * Categories for one fiscal year (`?fy=2026`, default the current one), with what's charged
   * against them. Spent is the only number taken from a budget: orders placed that year at the
   * final prices entered, plus their fees. Approved (not ordered) and pending are open requests'
   * estimates, shown but not counted.
   */
  .get("/", requireAuth, fyQuery, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const teamId = c.get("teamId");
    const calendar = await teamCalendar(db, teamId, localTimeZone(c));
    const fy = Number(c.req.valid("query").fy ?? fiscalYearOf(Date.now(), calendar));
    const [categories, budgets, requests, spent] = await Promise.all([
      db
        .select()
        .from(budgetCategories)
        .where(inTeam(budgetCategories, teamId))
        .orderBy(asc(budgetCategories.name))
        .all(),
      db
        .select()
        .from(categoryBudgets)
        .where(inTeam(categoryBudgets, teamId, eq(categoryBudgets.fiscalYear, fy)))
        .all(),
      db
        .select({
          categoryId: orderRequests.categoryId,
          status: orderRequests.status,
          quantity: orderRequests.quantity,
          unitPriceCents: orderRequests.unitPriceCents,
        })
        .from(orderRequests)
        .where(
          inTeam(orderRequests, teamId, inArray(orderRequests.status, ["requested", "approved"])),
        )
        .all(),
      spentByCategory(db, teamId, calendar, fy),
    ]);
    const budgetOf = new Map(budgets.map((b) => [b.categoryId, b.budgetCents]));
    return c.json(
      categories.map((cat) => {
        const estimate = (status: string) =>
          requests
            .filter((r) => r.categoryId === cat.id && r.status === status)
            .reduce((n, r) => n + lineTotal(r), 0);
        return {
          id: cat.id,
          name: cat.name,
          code: cat.code,
          fiscalYear: fy,
          budgetCents: budgetOf.get(cat.id) ?? null,
          isArchived: cat.isArchived === 1,
          spentCents: spent.get(cat.id) ?? 0,
          committedCents: estimate("approved"),
          pendingCents: estimate("requested"),
        };
      }),
    );
  })
  /** Fiscal years with budgets or orders, plus the current one, newest first. */
  .get("/years", requireAuth, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const teamId = c.get("teamId");
    const [calendar, budgetYears, orders] = await Promise.all([
      teamCalendar(db, teamId, localTimeZone(c)),
      db
        .selectDistinct({ fy: categoryBudgets.fiscalYear })
        .from(categoryBudgets)
        .where(inTeam(categoryBudgets, teamId))
        .all(),
      db
        .select({ placedAt: vendorOrders.placedAt })
        .from(vendorOrders)
        .where(inTeam(vendorOrders, teamId))
        .all(),
    ]);
    const current = fiscalYearOf(Date.now(), calendar);
    const years = new Set([
      current,
      ...budgetYears.map((b) => b.fy),
      ...orders.map((o) => fiscalYearOf(o.placedAt, calendar)),
    ]);
    return c.json({ current, years: [...years].sort((a, b) => b - a) });
  })
  .post("/", requireMentor, categoryValidator(true), async (c) => {
    const body = c.req.valid("json");
    const db = createOrdersDb(c.env.ORDERS_DB);
    const teamId = c.get("teamId");
    const existing = await db
      .select({ id: budgetCategories.id })
      .from(budgetCategories)
      .where(inTeam(budgetCategories, teamId, eq(budgetCategories.name, body.name as string)))
      .get();
    if (existing) return c.json({ error: "A category with that name already exists." }, 409);
    const row = await db
      .insert(budgetCategories)
      .values(
        withTeam(teamId, {
          name: body.name as string,
          code: body.code ?? null,
          isArchived: body.isArchived ? 1 : 0,
          createdAt: Date.now(),
        }),
      )
      .returning()
      .get();
    if (body.budgetCents !== undefined) {
      const fy =
        body.fiscalYear ??
        fiscalYearOf(Date.now(), await teamCalendar(db, teamId, localTimeZone(c)));
      await setBudget(db, teamId, row.id, fy, body.budgetCents);
    }
    return c.json({ ...row, isArchived: row.isArchived === 1 }, 201);
  })
  /** Rename, set the code, archive, or set the budget for `fiscalYear` (default: current). */
  .patch("/:id", requireMentor, categoryValidator(false), async (c) => {
    const body = c.req.valid("json");
    const id = Number(c.req.param("id"));
    const db = createOrdersDb(c.env.ORDERS_DB);
    const teamId = c.get("teamId");
    const updates: Partial<typeof budgetCategories.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.code !== undefined) updates.code = body.code;
    if (body.isArchived !== undefined) updates.isArchived = body.isArchived ? 1 : 0;
    if (Object.keys(updates).length === 0 && body.budgetCents === undefined) {
      return c.json({ error: "Nothing to update." }, 400);
    }
    const current = await db
      .select()
      .from(budgetCategories)
      .where(inTeam(budgetCategories, teamId, eq(budgetCategories.id, id)))
      .get();
    if (!current) return c.json({ error: "Category not found." }, 404);
    try {
      const row =
        Object.keys(updates).length > 0
          ? await db
              .update(budgetCategories)
              .set(updates)
              .where(inTeam(budgetCategories, teamId, eq(budgetCategories.id, id)))
              .returning()
              .get()
          : current;
      if (body.budgetCents !== undefined) {
        const fy =
          body.fiscalYear ??
          fiscalYearOf(Date.now(), await teamCalendar(db, teamId, localTimeZone(c)));
        await setBudget(db, teamId, id, fy, body.budgetCents);
      }
      return c.json({ ...row, isArchived: row.isArchived === 1 });
    } catch (err) {
      if (String(err).includes("UNIQUE")) {
        return c.json({ error: "A category with that name already exists." }, 409);
      }
      throw err;
    }
  });
