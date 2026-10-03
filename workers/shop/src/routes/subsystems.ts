import { requireAuth } from "@g3/auth";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { subsystems } from "../db/schema";
import type { AppEnv } from "../types";

export const subsystemsRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const rows = await db.select().from(subsystems).all();
    return c.json(rows);
  })
  .post("/", requireAuth, async (c) => {
    const { name } = await c.req.json<{ name: string }>();
    if (!name) return c.json({ error: "name is required." }, 400);

    const db = createShopDb(c.env.SHOP_DB);
    const row = await db
      .insert(subsystems)
      .values({ name, createdAt: Date.now() })
      .returning()
      .get();

    return c.json(row, 201);
  });
