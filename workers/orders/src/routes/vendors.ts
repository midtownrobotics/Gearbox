import { hasMentorAccess, inTeam, requireAuth, requireMentor, withTeam } from "@g3/auth";
import { eq, gte, lt } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createOrdersDb } from "../db";
import {
  CREDIT_KINDS,
  budgetCategories,
  orderRequests,
  vendorCredits,
  vendorOrders,
  vendors,
} from "../db/schema";
import { fiscalRange, fiscalYearOf } from "../lib/fiscal";
import { localTimeZone } from "../lib/local-time";
import { teamCalendar } from "../lib/settings";
import { vendorKey } from "../lib/vendors";
import type { AppEnv } from "../types";

type Profile = Partial<
  Omit<
    typeof vendors.$inferInsert,
    "teamId" | "key" | "updatedAt" | "taxExempt" | "teamAccountLogin"
  > & {
    taxExempt: boolean;
    teamAccountLogin: boolean;
  }
>;

const CENTS = ["freeShippingCents", "typicalShippingCents", "minimumOrderCents"] as const;
const DAYS = ["leadTimeDays", "shippingDays"] as const;
const TEXT = ["orderCutoff", "paymentMethod", "accountOwner", "notes"] as const;
const FLAGS = ["taxExempt", "teamAccountLogin"] as const;

const isCount = (v: unknown, max: number) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

const profileValidator = validator("json", (value, c): Profile => {
  const v = (value ?? {}) as Record<string, unknown>;
  const fail = (error: string) => c.json({ error }, 400) as never;
  const out: Profile = {};
  if (v.name !== undefined) {
    if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 100)
      return fail("name must be 1–100 characters.");
    out.name = v.name.trim();
  }
  for (const k of CENTS) {
    if (v[k] === undefined) continue;
    if (v[k] !== null && !isCount(v[k], 100_000_000))
      return fail(`${k} must be whole cents or null.`);
    out[k] = v[k] as number | null;
  }
  for (const k of DAYS) {
    if (v[k] === undefined) continue;
    if (v[k] !== null && !isCount(v[k], 365)) return fail(`${k} must be 0–365 days or null.`);
    out[k] = v[k] as number | null;
  }
  for (const k of TEXT) {
    if (v[k] === undefined) continue;
    if (v[k] !== null && (typeof v[k] !== "string" || (v[k] as string).length > 500)) {
      return fail(`${k} must be text up to 500 characters.`);
    }
    out[k] = typeof v[k] === "string" && (v[k] as string).trim() ? (v[k] as string).trim() : null;
  }
  for (const k of FLAGS) {
    if (v[k] === undefined) continue;
    if (typeof v[k] !== "boolean") return fail(`${k} must be true or false.`);
    out[k] = v[k] as boolean;
  }
  if (v.taxExemptExpires !== undefined) {
    if (v.taxExemptExpires !== null && !isCount(v.taxExemptExpires, 9e15))
      return fail("taxExemptExpires must be a date (ms) or null.");
    out.taxExemptExpires = v.taxExemptExpires as number | null;
  }
  if (v.defaultCategoryId !== undefined) {
    if (v.defaultCategoryId !== null && !Number.isInteger(v.defaultCategoryId))
      return fail("defaultCategoryId must be a category id or null.");
    out.defaultCategoryId = v.defaultCategoryId as number | null;
  }
  return out;
});

type CreditInput = {
  kind: (typeof CREDIT_KINDS)[number];
  label: string;
  code: string | null;
  balanceCents: number | null;
  expiresAt: number | null;
};

const creditValidator = (partial: boolean) =>
  validator("json", (value, c): Partial<CreditInput> => {
    const v = (value ?? {}) as Record<string, unknown>;
    const fail = (error: string) => c.json({ error }, 400) as never;
    const out: Partial<CreditInput> = {};
    if (v.kind !== undefined || !partial) {
      if (!CREDIT_KINDS.includes(v.kind as CreditInput["kind"]))
        return fail("kind must be voucher, credit or discount.");
      out.kind = v.kind as CreditInput["kind"];
    }
    if (v.label !== undefined || !partial) {
      if (typeof v.label !== "string" || !v.label.trim() || v.label.length > 100)
        return fail("label must be 1–100 characters.");
      out.label = v.label.trim();
    }
    if (v.code !== undefined) {
      if (v.code !== null && (typeof v.code !== "string" || v.code.length > 100))
        return fail("code must be text up to 100 characters.");
      out.code = typeof v.code === "string" && v.code.trim() ? v.code.trim() : null;
    }
    if (v.balanceCents !== undefined) {
      if (v.balanceCents !== null && !isCount(v.balanceCents, 100_000_000))
        return fail("balanceCents must be whole cents or null.");
      out.balanceCents = v.balanceCents as number | null;
    }
    if (v.expiresAt !== undefined) {
      if (v.expiresAt !== null && !isCount(v.expiresAt, 9e15))
        return fail("expiresAt must be a date (ms) or null.");
      out.expiresAt = v.expiresAt as number | null;
    }
    return out;
  });

export const vendorsRouter = new Hono<AppEnv>()
  /**
   * Every vendor seen on a request or with a profile, with its profile. Everyone gets lead and
   * shipping times (for place-by dates); payment, account, notes and credits are mentors-only.
   */
  .get("/", requireAuth, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const teamId = c.get("teamId");
    const calendar = await teamCalendar(db, teamId, localTimeZone(c));
    const [from, to] = fiscalRange(fiscalYearOf(Date.now(), calendar), calendar);
    const [profiles, requests, credits, orders] = await Promise.all([
      db.select().from(vendors).where(inTeam(vendors, teamId)).all(),
      db
        .select({ vendor: orderRequests.vendor, status: orderRequests.status })
        .from(orderRequests)
        .where(inTeam(orderRequests, teamId))
        .all(),
      db.select().from(vendorCredits).where(inTeam(vendorCredits, teamId)).all(),
      db
        .select({ vendor: vendorOrders.vendor })
        .from(vendorOrders)
        .where(
          inTeam(
            vendorOrders,
            teamId,
            gte(vendorOrders.placedAt, from),
            lt(vendorOrders.placedAt, to),
          ),
        )
        .all(),
    ]);
    const mentor = hasMentorAccess(c);
    const names = new Map<string, string>();
    for (const r of requests)
      if (!names.has(vendorKey(r.vendor))) names.set(vendorKey(r.vendor), r.vendor.trim());
    for (const p of profiles) names.set(p.key, p.name);
    const byKey = new Map(profiles.map((p) => [p.key, p]));

    return c.json(
      [...names]
        .map(([key, name]) => {
          const p = byKey.get(key);
          const openItems = requests.filter(
            (r) => vendorKey(r.vendor) === key && r.status === "approved",
          ).length;
          const ordersThisYear = orders.filter((o) => vendorKey(o.vendor) === key).length;
          const base = {
            key,
            name,
            hasProfile: p !== undefined,
            leadTimeDays: p?.leadTimeDays ?? null,
            shippingDays: p?.shippingDays ?? null,
            openItems,
            ordersThisYear,
          };
          if (!mentor) return base;
          return {
            ...base,
            taxExempt: p?.taxExempt === 1,
            taxExemptExpires: p?.taxExemptExpires ?? null,
            teamAccountLogin: p?.teamAccountLogin === 1,
            freeShippingCents: p?.freeShippingCents ?? null,
            typicalShippingCents: p?.typicalShippingCents ?? null,
            minimumOrderCents: p?.minimumOrderCents ?? null,
            orderCutoff: p?.orderCutoff ?? null,
            paymentMethod: p?.paymentMethod ?? null,
            accountOwner: p?.accountOwner ?? null,
            notes: p?.notes ?? null,
            defaultCategoryId: p?.defaultCategoryId ?? null,
            credits: credits.filter((cr) => cr.vendorKey === key),
          };
        })
        .sort((a, b) => b.openItems - a.openItems || a.name.localeCompare(b.name)),
    );
  })
  /** Creates or updates a vendor's profile (the key is its lowercased name). */
  .put("/:key", requireMentor, profileValidator, async (c) => {
    const key = vendorKey(decodeURIComponent(c.req.param("key")));
    if (!key) return c.json({ error: "Vendor name is required." }, 400);
    const { taxExempt, teamAccountLogin, ...rest } = c.req.valid("json");
    const body = {
      ...rest,
      ...(taxExempt === undefined ? {} : { taxExempt: taxExempt ? 1 : 0 }),
      ...(teamAccountLogin === undefined ? {} : { teamAccountLogin: teamAccountLogin ? 1 : 0 }),
    };
    const db = createOrdersDb(c.env.ORDERS_DB);
    const teamId = c.get("teamId");
    if (body.defaultCategoryId) {
      const category = await db
        .select({ id: budgetCategories.id })
        .from(budgetCategories)
        .where(inTeam(budgetCategories, teamId, eq(budgetCategories.id, body.defaultCategoryId)))
        .get();
      if (!category)
        return c.json({ error: "defaultCategoryId must be a category id or null." }, 400);
    }
    const now = Date.now();
    const row = await db
      .insert(vendors)
      .values(
        withTeam(teamId, {
          key,
          name: body.name ?? decodeURIComponent(c.req.param("key")).trim(),
          ...body,
          updatedAt: now,
        }),
      )
      .onConflictDoUpdate({
        target: [vendors.teamId, vendors.key],
        set: { ...body, updatedAt: now },
      })
      .returning()
      .get();
    return c.json(row);
  })
  .post("/:key/credits", requireMentor, creditValidator(false), async (c) => {
    const vendor = vendorKey(decodeURIComponent(c.req.param("key")));
    const body = c.req.valid("json") as CreditInput;
    const db = createOrdersDb(c.env.ORDERS_DB);
    const row = await db
      .insert(vendorCredits)
      .values(
        withTeam(c.get("teamId"), {
          vendorKey: vendor,
          kind: body.kind,
          label: body.label,
          code: body.code ?? null,
          balanceCents: body.balanceCents ?? null,
          expiresAt: body.expiresAt ?? null,
          createdAt: Date.now(),
        }),
      )
      .returning()
      .get();
    return c.json(row, 201);
  })
  .patch("/credits/:id", requireMentor, creditValidator(true), async (c) => {
    const body = c.req.valid("json");
    if (Object.keys(body).length === 0) return c.json({ error: "Nothing to update." }, 400);
    const db = createOrdersDb(c.env.ORDERS_DB);
    const row = await db
      .update(vendorCredits)
      .set(body)
      .where(
        inTeam(vendorCredits, c.get("teamId"), eq(vendorCredits.id, Number(c.req.param("id")))),
      )
      .returning()
      .get();
    if (!row) return c.json({ error: "Credit not found." }, 404);
    return c.json(row);
  })
  .delete("/credits/:id", requireMentor, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const row = await db
      .delete(vendorCredits)
      .where(
        inTeam(vendorCredits, c.get("teamId"), eq(vendorCredits.id, Number(c.req.param("id")))),
      )
      .returning()
      .get();
    if (!row) return c.json({ error: "Credit not found." }, 404);
    return c.json({ ok: true });
  });
