import { logTeamChange, requireAdmin } from "@g3/auth";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { parseStatusLevels, saveStatusLevels, statusLevelsFor } from "../lib/shop-status";
import type { AppEnv } from "../types";

// The Overview's shop status words, on Shop's Admin page (admins only). Everyone reads them in /me.
export const shopStatusRouter = new Hono<AppEnv>()
  .get("/", requireAdmin, async (c) =>
    c.json({ levels: await statusLevelsFor(createShopDb(c.env.SHOP_DB), c.get("teamId")) }),
  )
  .put("/", requireAdmin, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { levels?: unknown } | null;
    const parsed = parseStatusLevels(body?.levels);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    const teamId = c.get("teamId");
    await saveStatusLevels(createShopDb(c.env.SHOP_DB), teamId, parsed.levels);
    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "shop",
      what: "Shop status",
    });
    return c.json({ levels: parsed.levels });
  });
