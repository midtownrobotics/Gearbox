import { requireAuth, requireMentor } from "@g3/auth";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createOrdersDb } from "../db";
import { orderRequests } from "../db/schema";
import { inChunks } from "../lib/chunks";
import {
  SAC_VENDORS,
  SacError,
  type SacItem,
  connection,
  disconnect,
  finishConnect,
  saveCart,
  startConnect,
} from "../lib/share-a-cart";
import { vendorKey } from "../lib/vendors";
import type { AppEnv } from "../types";

const callbackUrl = (env: AppEnv["Bindings"]) => `${env.PUBLIC_API_URL}/share-a-cart/callback`;

/** The Amazon ASIN Share-A-Cart's `asin` field wants: from the product link, or the SKU. */
export function storeItemId(line: { url: string; sku: string | null }): string | null {
  let path = "";
  try {
    path = new URL(line.url).pathname;
  } catch {
    // Not a URL (some imported rows); fall back to the SKU.
  }
  const sku = line.sku?.trim() || null;
  return (
    path
      .match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]
      ?.toUpperCase() ?? (sku && /^[A-Z0-9]{10}$/i.test(sku) ? sku.toUpperCase() : null)
  );
}

const cartValidator = validator(
  "json",
  (value, c): { vendor: string; lines: { requestId: number; quantity: number }[] } => {
    const v = (value ?? {}) as Record<string, unknown>;
    if (typeof v.vendor !== "string" || !v.vendor.trim()) {
      return c.json({ error: "vendor is required." }, 400) as never;
    }
    if (!Array.isArray(v.lines) || v.lines.length === 0 || v.lines.length > 100) {
      return c.json({ error: "A cart needs 1–100 lines." }, 400) as never;
    }
    const lines = (v.lines as Record<string, unknown>[]).map((l) => ({
      requestId: Number(l?.requestId),
      quantity: Number(l?.quantity),
    }));
    if (
      lines.some(
        (l) => !Number.isInteger(l.requestId) || !Number.isInteger(l.quantity) || l.quantity < 1,
      )
    ) {
      return c.json(
        { error: "Each line needs a requestId and a quantity of at least 1." },
        400,
      ) as never;
    }
    return { vendor: v.vendor.trim(), lines };
  },
);

export const shareACartRouter = new Hono<AppEnv>()
  /** Whether the team's account is connected, and which vendors it can build carts for. */
  .get("/status", requireAuth, async (c) => {
    const auth = await connection(createOrdersDb(c.env.ORDERS_DB));
    return c.json({
      connected: auth !== null,
      connectedBy: auth?.connectedBy ?? null,
      connectedAt: auth?.connectedAt ?? null,
      vendors: Object.keys(SAC_VENDORS),
    });
  })
  /** Opened in the browser by a mentor: sends them to sign in to Share-A-Cart and approve. */
  .get("/connect", requireMentor, async (c) => {
    try {
      const url = await startConnect(
        createOrdersDb(c.env.ORDERS_DB),
        callbackUrl(c.env),
        c.get("userDisplayName"),
      );
      return c.redirect(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.redirect(`${c.env.FRONTEND_URL}/settings?sac_error=${encodeURIComponent(message)}`);
    }
  })
  /** Where Share-A-Cart sends the mentor back; the one-time `state` ties it to their attempt. */
  .get("/callback", async (c) => {
    const back = (params: string) => c.redirect(`${c.env.FRONTEND_URL}/settings?${params}`);
    const { code, state, error, error_description: description } = c.req.query();
    if (error) return back(`sac_error=${encodeURIComponent(description || error)}`);
    if (!code || !state)
      return back(`sac_error=${encodeURIComponent("Share-A-Cart didn't send a sign-in code.")}`);
    try {
      await finishConnect(createOrdersDb(c.env.ORDERS_DB), callbackUrl(c.env), code, state);
      return back("sac=connected");
    } catch (err) {
      return back(
        `sac_error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`,
      );
    }
  })
  .post("/disconnect", requireMentor, async (c) => {
    await disconnect(createOrdersDb(c.env.ORDERS_DB));
    return c.json({ ok: true });
  })
  /**
   * Builds a Share-A-Cart cart from approved lines at one vendor (quantities as edited on the
   * Ordering tab) and returns its link. Lines without an ASIN are left out and reported.
   */
  .post("/carts", requireMentor, cartValidator, async (c) => {
    const { vendor, lines } = c.req.valid("json");
    const sacVendor = SAC_VENDORS[vendorKey(vendor)];
    if (!sacVendor) return c.json({ error: `Share-A-Cart doesn't support ${vendor}.` }, 400);
    const db = createOrdersDb(c.env.ORDERS_DB);
    const rows = await inChunks(
      lines.map((l) => l.requestId),
      (chunk) =>
        db
          .select()
          .from(orderRequests)
          .where(and(inArray(orderRequests.id, chunk), eq(orderRequests.status, "approved")))
          .all(),
    );
    const qty = new Map(lines.map((l) => [l.requestId, l.quantity]));
    const items: SacItem[] = [];
    const skipped: string[] = [];
    for (const r of rows) {
      const asin = storeItemId(r);
      if (!asin) {
        skipped.push(r.title);
        continue;
      }
      items.push({
        asin,
        name: r.variant ? `${r.title} (${r.variant})` : r.title,
        ...(r.image ? { img: r.image } : {}),
        ...(r.unitPriceCents !== null ? { price: r.unitPriceCents / 100 } : {}),
        quantity: qty.get(r.id) ?? r.quantity,
        ...(r.url ? { url: r.url } : {}),
      });
    }
    if (items.length === 0) {
      return c.json(
        { error: "None of these items have an Amazon ASIN Share-A-Cart can use." },
        400,
      );
    }
    try {
      const day = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
      const cart = await saveCart(db, {
        vendor: sacVendor,
        title: `${vendor} order (${day})`,
        items,
      });
      return c.json({ ...cart, added: items.length, skipped });
    } catch (err) {
      if (err instanceof SacError) return c.json({ error: err.message }, 502);
      throw err;
    }
  });
