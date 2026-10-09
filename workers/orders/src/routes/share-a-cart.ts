import { inTeam, requestTeamId, requireAuth, requireMentor } from "@g3/auth";
import { eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createOrdersDb } from "../db";
import { orderRequests } from "../db/schema";
import { expandAmazonLink } from "../lib/amazon-link";
import { inChunks } from "../lib/chunks";
import { localTimeZone } from "../lib/local-time";
import { amazonAsin, isAmazonShortLink } from "../lib/product-key";
import { teamSettings } from "../lib/settings";
import {
  SAC_VENDORS,
  SacError,
  type SacItem,
  type Team,
  connection,
  disconnect,
  finishConnect,
  saveCart,
  startConnect,
} from "../lib/share-a-cart";
import { ordersUrl } from "../lib/urls";
import { vendorKey } from "../lib/vendors";
import type { AppEnv } from "../types";

// Share-A-Cart sends the mentor back to their own team's address, so the callback (which has no
// session to go on) is for the team the gateway says, and finds the sign-in among that team's.
const callbackUrl = (env: AppEnv["Bindings"], teamId: string) =>
  `${ordersUrl(env, teamId)}/api/share-a-cart/callback`;
const settingsPage = (env: AppEnv["Bindings"], teamId: string, params: string) =>
  `${ordersUrl(env, teamId)}/settings?${params}`;

/** The request's team and its database. */
const teamOf = (c: Context<AppEnv>, teamId = c.get("teamId")): Team => ({
  db: createOrdersDb(c.env.ORDERS_DB),
  teamId,
  secretsKey: c.env.SECRETS_KEY,
});

/** The Amazon ASIN Share-A-Cart's `asin` field wants: from the product link, or the SKU. */
export const storeItemId = amazonAsin;

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
    const auth = await connection(teamOf(c));
    return c.json({
      connected: auth !== null,
      connectedBy: auth?.connectedBy ?? null,
      connectedAt: auth?.connectedAt ?? null,
      vendors: Object.keys(SAC_VENDORS),
    });
  })
  /** Opened in the browser by a mentor: sends them to sign in to Share-A-Cart and approve. */
  .get("/connect", requireMentor, async (c) => {
    const teamId = c.get("teamId");
    try {
      const url = await startConnect(
        teamOf(c),
        callbackUrl(c.env, teamId),
        c.get("userDisplayName"),
      );
      return c.redirect(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.redirect(settingsPage(c.env, teamId, `sac_error=${encodeURIComponent(message)}`));
    }
  })
  /** Where Share-A-Cart sends the mentor back; the one-time `state` ties it to their attempt. */
  .get("/callback", async (c) => {
    const teamId = requestTeamId(c);
    const back = (params: string) => c.redirect(settingsPage(c.env, teamId, params));
    const { code, state, error, error_description: description } = c.req.query();
    if (error) return back(`sac_error=${encodeURIComponent(description || error)}`);
    if (!code || !state)
      return back(`sac_error=${encodeURIComponent("Share-A-Cart didn't send a sign-in code.")}`);
    try {
      await finishConnect(teamOf(c, teamId), callbackUrl(c.env, teamId), code, state);
      return back("sac=connected");
    } catch (err) {
      return back(
        `sac_error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`,
      );
    }
  })
  .post("/disconnect", requireMentor, async (c) => {
    await disconnect(teamOf(c));
    return c.json({ ok: true });
  })
  /**
   * Builds a Share-A-Cart cart from approved lines at one vendor (quantities as edited on the
   * Carts page) and returns its link. Lines without an ASIN are left out and reported.
   */
  .post("/carts", requireMentor, cartValidator, async (c) => {
    const { vendor, lines } = c.req.valid("json");
    const sacVendor = SAC_VENDORS[vendorKey(vendor)];
    if (!sacVendor) return c.json({ error: `Share-A-Cart doesn't support ${vendor}.` }, 400);
    const team = teamOf(c);
    const { db, teamId } = team;
    const rows = await inChunks(
      lines.map((l) => l.requestId),
      (chunk) =>
        db
          .select()
          .from(orderRequests)
          .where(
            inTeam(
              orderRequests,
              teamId,
              inArray(orderRequests.id, chunk),
              eq(orderRequests.status, "approved"),
            ),
          )
          .all(),
    );
    const qty = new Map(lines.map((l) => [l.requestId, l.quantity]));
    const items: SacItem[] = [];
    const skipped: string[] = [];
    for (const r of rows) {
      // A share link (a.co) saved before links were expanded, or when the expansion failed.
      const asin =
        storeItemId(r) ??
        (isAmazonShortLink(r.url)
          ? storeItemId({ ...r, url: await expandAmazonLink(r.url) })
          : null);
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
      const settings = await teamSettings(db, teamId);
      const day = new Date().toLocaleDateString("en-US", { timeZone: localTimeZone(c) });
      const cart = await saveCart(team, {
        vendor: sacVendor,
        title: `${vendor} order (${day})`,
        items,
        currency: settings.currency,
      });
      return c.json({ ...cart, added: items.length, skipped });
    } catch (err) {
      if (err instanceof SacError) return c.json({ error: err.message }, 502);
      throw err;
    }
  });
