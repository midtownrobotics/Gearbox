import { requireMentor } from "@g3/auth";
import { appTitle } from "@g3/site-config";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createOrdersDb } from "../db";
import { appUsers } from "../db/schema";
import type { AppEnv } from "../types";

const trustedValidator = validator("json", (value, c): { trusted: boolean } => {
  const trusted = (value as { trusted?: unknown })?.trusted;
  if (typeof trusted !== "boolean") {
    return c.json({ error: "trusted must be true or false." }, 400) as never;
  }
  return { trusted };
});

/**
 * Trusted students (mentors only): people who may add catalog categories and add, edit or delete
 * catalog parts. Anyone who has opened G3 Orders is listed.
 */
export const trustedRouter = new Hono<AppEnv>()
  .get("/", requireMentor, async (c) => {
    const db = createOrdersDb(c.env.ORDERS_DB);
    const rows = await db.select().from(appUsers).orderBy(asc(appUsers.name)).all();
    return c.json(rows.map((u) => ({ ...u, trusted: u.trusted === 1 })));
  })
  .put("/:id", requireMentor, trustedValidator, async (c) => {
    const body = c.req.valid("json");
    const db = createOrdersDb(c.env.ORDERS_DB);
    const row = await db
      .update(appUsers)
      .set(
        body.trusted
          ? { trusted: 1, trustedBy: c.get("userDisplayName"), trustedAt: Date.now() }
          : { trusted: 0, trustedBy: null, trustedAt: null },
      )
      .where(eq(appUsers.id, c.req.param("id")))
      .returning()
      .get();
    if (!row) return c.json({ error: `That person hasn't opened ${appTitle("Orders")} yet.` }, 404);
    return c.json({ ...row, trusted: row.trusted === 1 });
  });
