import { requireAuth } from "@g3/auth";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createDb } from "../db";
import { locations } from "../db/schema";
import { parseId, textField } from "../lib/input";
import { MAX_TITLE } from "../lib/locations";
import { actorOf, loadNames, moveLocationContents } from "../lib/stock";
import type { AppEnv } from "../types";

// What members do to a location from the Locations page: give it a title that says what's kept
// there, and move everything in it somewhere else. Neither changes the tree of locations itself
// (that's Settings, for admins), so anyone signed in can, kiosk sessions included.

const GONE = "That location no longer exists.";

const titleValidator = validator("json", (value, c): { title: string } => {
  const title = textField((value as { title?: unknown } | null)?.title ?? "", MAX_TITLE);
  if (title === null) {
    return c.json({ error: `title must be up to ${MAX_TITLE} characters.` }, 400) as never;
  }
  return { title };
});

const moveValidator = validator("json", (value, c): { toLocationId: number } => {
  const toLocationId = parseId((value as { toLocationId?: unknown } | null)?.toLocationId);
  if (toLocationId === null) return c.json({ error: "Pick a location." }, 400) as never;
  return { toLocationId };
});

export const locationContentsRouter = new Hono<AppEnv>()
  /**
   * A location's title: a few words on what's kept there, shown beside its name everywhere
   * ("A1 - Misc. Electronics"). Empty takes it off.
   */
  .put("/:id/title", requireAuth, titleValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    const { title } = c.req.valid("json");
    const db = createDb(c.env.INVENTORY_DB);
    const row =
      id === null
        ? undefined
        : await db
            .update(locations)
            .set({ title })
            .where(eq(locations.id, id))
            .returning({ id: locations.id })
            .get();
    if (!row) return c.json({ error: GONE }, 404);
    return c.json({ ok: true });
  })
  /**
   * Moves everything kept directly in a location to another one, whole quantities and all, for
   * when a bin's contents are rearranged. The locations themselves stay as they are.
   */
  .post("/:id/move-contents", requireAuth, moveValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    const { toLocationId } = c.req.valid("json");
    const d1 = c.env.INVENTORY_DB;
    const names = await loadNames(createDb(d1));
    if (id === null || !names.locations.byId.has(id)) return c.json({ error: GONE }, 404);
    if (!names.locations.byId.has(toLocationId)) return c.json({ error: "Pick a location." }, 400);
    if (toLocationId === id) {
      return c.json({ error: "Pick a different location to move them to." }, 400);
    }
    return c.json(await moveLocationContents(d1, id, toLocationId, names, actorOf(c)));
  });
