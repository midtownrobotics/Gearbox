import { requireAdmin } from "@g3/auth";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createDb } from "../db";
import { FIELD_TYPES, type FieldType, fields, locations } from "../db/schema";
import { parseOptions } from "../lib/fields";
import { parseId, sameName, textField } from "../lib/input";
import { MAX_DEPTH, depthOf, indexLocations, loadLocations } from "../lib/locations";
import {
  MAX_CHOICES,
  MAX_FIELDS,
  MAX_LOCATIONS,
  MAX_NAME,
  MAX_ROBOTS,
  MAX_SUBSYSTEMS,
  exportSetup,
  loadSetup,
  parseSetup,
  starterSetup,
} from "../lib/setup";
import type { AppEnv } from "../types";

// The Settings page: how a team has Inventory arranged. Its fields, its tree of locations, its
// robots and subsystems are all the team's own, so all of it is made here (or loaded from a setup
// file) and none of it is in the code. G3ID admins only, and never from a kiosk.

const NAME_ERROR = `name must be 1–${MAX_NAME} characters.`;

/** `{ ids }`: rows of one list in the order they should be shown. */
const orderValidator = validator("json", (value, c): { ids: number[] } => {
  const raw = (value as Record<string, unknown> | null)?.ids;
  const ids = Array.isArray(raw) ? raw.map(parseId) : [];
  if (ids.length === 0 || ids.length > 500 || ids.includes(null)) {
    return c.json({ error: "ids must be a list of 1–500 ids." }, 400) as never;
  }
  return { ids: [...new Set(ids as number[])] };
});

const reorder = (d1: D1Database, table: string, ids: number[]) =>
  d1.batch(
    ids.map((id, i) => d1.prepare(`UPDATE ${table} SET sort_order = ?2 WHERE id = ?1`).bind(id, i)),
  );

const nameValidator = validator("json", (value, c): { name: string } => {
  const name = textField((value as Record<string, unknown> | null)?.name, MAX_NAME, true);
  if (name === null) return c.json({ error: NAME_ERROR }, 400) as never;
  return { name };
});

/** Names from a request, trimmed, once each, or null if any is bad. */
function nameList(raw: unknown, max: number): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > max) return null;
  const out: string[] = [];
  for (const item of raw) {
    const name = textField(item, MAX_NAME, true);
    if (name === null) return null;
    if (!out.some((have) => sameName(have, name))) out.push(name);
  }
  return out;
}

// ---- Fields ----

type FieldInput = { name?: string; type?: FieldType; options?: string[]; showInTable?: boolean };

const fieldValidator = (partial: boolean) =>
  validator("json", (value, c): FieldInput => {
    const v = (value ?? {}) as Record<string, unknown>;
    const fail = (error: string) => c.json({ error }, 400) as never;
    const out: FieldInput = {};
    if (!partial || v.name !== undefined) {
      const name = textField(v.name, MAX_NAME, true);
      if (name === null) return fail(NAME_ERROR);
      out.name = name;
    }
    if (!partial) {
      const type = FIELD_TYPES.find((t) => t === v.type);
      if (!type) return fail(`type must be one of: ${FIELD_TYPES.join(", ")}.`);
      out.type = type;
    }
    if (v.options !== undefined) {
      const options = Array.isArray(v.options) && v.options.length === 0 ? [] : null;
      const list = options ?? nameList(v.options, MAX_CHOICES);
      if (list === null) return fail(`options must be up to ${MAX_CHOICES} names.`);
      out.options = list;
    }
    if (v.showInTable !== undefined) {
      if (typeof v.showInTable !== "boolean") return fail("showInTable must be true or false.");
      out.showInTable = v.showInTable;
    }
    return out;
  });

export const fieldsRouter = new Hono<AppEnv>()
  .post("/", requireAdmin, fieldValidator(false), async (c) => {
    const body = c.req.valid("json");
    const db = createDb(c.env.INVENTORY_DB);
    const have = await db.select().from(fields).all();
    if (have.length >= MAX_FIELDS) {
      return c.json({ error: `There can be at most ${MAX_FIELDS} fields.` }, 400);
    }
    if (have.some((row) => sameName(row.name, body.name ?? ""))) {
      return c.json({ error: "There's already a field with that name." }, 409);
    }
    const options = body.type === "choice" ? (body.options ?? []) : [];
    if (body.type === "choice" && options.length === 0) {
      return c.json({ error: "A choice field needs at least one choice." }, 400);
    }
    const made = await db
      .insert(fields)
      .values({
        name: body.name ?? "",
        type: body.type ?? "text",
        options: JSON.stringify(options),
        showInTable: body.showInTable === false ? 0 : 1,
        sortOrder: have.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1,
        createdAt: Date.now(),
      })
      .returning({ id: fields.id })
      .get();
    return c.json({ id: made.id }, 201);
  })
  .put("/order", requireAdmin, orderValidator, async (c) => {
    await reorder(c.env.INVENTORY_DB, "fields", c.req.valid("json").ids);
    return c.json({ ok: true });
  })
  /** Renames a field, changes its choices or whether the table shows it. Its type stays. */
  .patch("/:id", requireAdmin, fieldValidator(true), async (c) => {
    const id = parseId(c.req.param("id"));
    const body = c.req.valid("json");
    const db = createDb(c.env.INVENTORY_DB);
    const have = await db.select().from(fields).all();
    const row = have.find((field) => field.id === id);
    if (!row) return c.json({ error: "That field no longer exists." }, 404);
    if (
      body.name !== undefined &&
      have.some((f) => f.id !== row.id && sameName(f.name, body.name ?? ""))
    ) {
      return c.json({ error: "There's already a field with that name." }, 409);
    }
    let options = parseOptions(row.options);
    if (body.options !== undefined && row.type === "choice") {
      if (body.options.length === 0) {
        return c.json({ error: "A choice field needs at least one choice." }, 400);
      }
      options = body.options;
    }
    await db
      .update(fields)
      .set({
        name: body.name ?? row.name,
        options: JSON.stringify(options),
        showInTable: body.showInTable === undefined ? row.showInTable : body.showInTable ? 1 : 0,
      })
      .where(eq(fields.id, row.id));
    return c.json({ ok: true });
  })
  /** Removes a field. What entries had in it stops showing, and goes when they're next saved. */
  .delete("/:id", requireAdmin, async (c) => {
    const id = parseId(c.req.param("id"));
    if (id !== null) await createDb(c.env.INVENTORY_DB).delete(fields).where(eq(fields.id, id));
    return c.json({ ok: true });
  });

// ---- Locations ----

/** A location and everything inside it, as a subquery of ids. `?1` is the location. */
const SUBTREE = `WITH RECURSIVE inside(id) AS (
    SELECT ?1 UNION ALL SELECT l.id FROM locations l JOIN inside ON l.parent_id = inside.id
  ) SELECT id FROM inside`;

const newLocationsValidator = validator(
  "json",
  (value, c): { parentId: number | null; names: string[] } => {
    const v = (value ?? {}) as Record<string, unknown>;
    const fail = (error: string) => c.json({ error }, 400) as never;
    const parentId = v.parentId === null || v.parentId === undefined ? null : parseId(v.parentId);
    if (v.parentId !== null && v.parentId !== undefined && parentId === null) {
      return fail("parentId must be a location's id or null.");
    }
    // Several at once: a shelf's bins are tedious one at a time.
    const names = nameList(v.names ?? (v.name === undefined ? undefined : [v.name]), 200);
    if (names === null) return fail(`names must be 1–200 names of up to ${MAX_NAME} characters.`);
    return { parentId, names };
  },
);

const editLocationValidator = validator(
  "json",
  (value, c): { name?: string; parentId?: number | null } => {
    const v = (value ?? {}) as Record<string, unknown>;
    const out: { name?: string; parentId?: number | null } = {};
    if (v.name !== undefined) {
      const name = textField(v.name, MAX_NAME, true);
      if (name === null) return c.json({ error: NAME_ERROR }, 400) as never;
      out.name = name;
    }
    if (v.parentId !== undefined) {
      const parentId = v.parentId === null ? null : parseId(v.parentId);
      if (v.parentId !== null && parentId === null) {
        return c.json({ error: "parentId must be a location's id or null." }, 400) as never;
      }
      out.parentId = parentId;
    }
    return out;
  },
);

export const locationsRouter = new Hono<AppEnv>()
  /** Adds locations at the top level or inside one. Names already there are skipped. */
  .post("/", requireAdmin, newLocationsValidator, async (c) => {
    const { parentId, names } = c.req.valid("json");
    const db = createDb(c.env.INVENTORY_DB);
    const rows = await loadLocations(db);
    const { byId, childrenOf } = indexLocations(rows);
    if (parentId !== null) {
      if (!byId.has(parentId)) return c.json({ error: "That location no longer exists." }, 404);
      if (depthOf(parentId, byId) >= MAX_DEPTH) {
        return c.json({ error: `Locations can only be ${MAX_DEPTH} levels deep.` }, 400);
      }
    }
    const siblings = childrenOf.get(parentId) ?? [];
    const adding = names.filter((name) => !siblings.some((row) => sameName(row.name, name)));
    if (rows.length + adding.length > MAX_LOCATIONS) {
      return c.json({ error: `There can be at most ${MAX_LOCATIONS} locations.` }, 400);
    }
    const now = Date.now();
    const d1 = c.env.INVENTORY_DB;
    const last = await d1
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM locations")
      .first<{ next: number }>();
    const start = last?.next ?? 0;
    if (adding.length > 0) {
      await d1.batch(
        adding.map((name, i) =>
          d1
            .prepare(
              "INSERT INTO locations (parent_id, name, sort_order, created_at) VALUES (?1, ?2, ?3, ?4)",
            )
            .bind(parentId, name, start + i, now),
        ),
      );
    }
    return c.json({ added: adding.length, skipped: names.length - adding.length }, 201);
  })
  .put("/order", requireAdmin, orderValidator, async (c) => {
    await reorder(c.env.INVENTORY_DB, "locations", c.req.valid("json").ids);
    return c.json({ ok: true });
  })
  /** Renames a location, or moves it (with everything inside) to another place in the tree. */
  .patch("/:id", requireAdmin, editLocationValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    const body = c.req.valid("json");
    const db = createDb(c.env.INVENTORY_DB);
    const { byId, childrenOf } = indexLocations(await loadLocations(db));
    const row = id === null ? undefined : byId.get(id);
    if (!row) return c.json({ error: "That location no longer exists." }, 404);

    const parentId = body.parentId === undefined ? row.parentId : body.parentId;
    if (parentId !== row.parentId) {
      if (parentId !== null) {
        if (!byId.has(parentId)) return c.json({ error: "That location no longer exists." }, 404);
        // Not inside itself.
        for (let at = byId.get(parentId); at; ) {
          if (at.id === row.id) {
            return c.json({ error: "A location can't go inside itself." }, 400);
          }
          at = at.parentId === null ? undefined : byId.get(at.parentId);
        }
      }
      // Levels from this location down to its deepest one.
      const height = (at: number): number =>
        1 + Math.max(0, ...(childrenOf.get(at) ?? []).map((child) => height(child.id)));
      const above = parentId === null ? 0 : depthOf(parentId, byId);
      if (above + height(row.id) > MAX_DEPTH) {
        return c.json({ error: `Locations can only be ${MAX_DEPTH} levels deep.` }, 400);
      }
    }
    const name = body.name ?? row.name;
    const clash = (childrenOf.get(parentId) ?? []).some(
      (other) => other.id !== row.id && sameName(other.name, name),
    );
    if (clash) return c.json({ error: "There's already a location with that name there." }, 409);
    await db.update(locations).set({ name, parentId }).where(eq(locations.id, row.id));
    return c.json({ ok: true });
  })
  /** Removes a location and everything inside it, if no parts are kept there. */
  .delete("/:id", requireAdmin, async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ ok: true });
    const d1 = c.env.INVENTORY_DB;
    const held = await d1
      .prepare(
        `SELECT COUNT(DISTINCT item_id) AS n FROM stock WHERE quantity > 0 AND location_id IN (${SUBTREE})`,
      )
      .bind(id)
      .first<{ n: number }>();
    if (held && held.n > 0) {
      return c.json(
        {
          error: `${held.n} ${held.n === 1 ? "entry has" : "entries have"} parts there. Move them first.`,
        },
        409,
      );
    }
    try {
      await d1.batch([
        // Empty rows that only remember where an entry lived.
        d1
          .prepare(`DELETE FROM stock WHERE quantity = 0 AND location_id IN (${SUBTREE})`)
          .bind(id),
        d1.prepare(`DELETE FROM locations WHERE id IN (${SUBTREE})`).bind(id),
      ]);
    } catch (err) {
      console.error("[inventory] delete location", err);
      return c.json({ error: "Parts were just put there. Move them first." }, 409);
    }
    return c.json({ ok: true });
  });

// ---- Robots and subsystems: what parts in use are in use on ----

function namedRouter(table: "robots" | "subsystems", column: string, what: string, max: number) {
  return (
    new Hono<AppEnv>()
      .post("/", requireAdmin, nameValidator, async (c) => {
        const { name } = c.req.valid("json");
        const d1 = c.env.INVENTORY_DB;
        const { results } = await d1
          .prepare(`SELECT name, sort_order AS sortOrder FROM ${table}`)
          .all<{ name: string; sortOrder: number }>();
        if (results.length >= max) {
          return c.json({ error: `There can be at most ${max} ${what}s.` }, 400);
        }
        if (results.some((row) => sameName(row.name, name))) {
          return c.json({ error: `There's already a ${what} with that name.` }, 409);
        }
        const next = results.reduce((top, row) => Math.max(top, row.sortOrder), -1) + 1;
        const made = await d1
          .prepare(
            `INSERT INTO ${table} (name, sort_order, created_at) VALUES (?1, ?2, ?3) RETURNING id`,
          )
          .bind(name, next, Date.now())
          .first<{ id: number }>();
        return c.json({ id: made?.id ?? 0 }, 201);
      })
      .put("/order", requireAdmin, orderValidator, async (c) => {
        await reorder(c.env.INVENTORY_DB, table, c.req.valid("json").ids);
        return c.json({ ok: true });
      })
      .patch("/:id", requireAdmin, nameValidator, async (c) => {
        const id = parseId(c.req.param("id"));
        const { name } = c.req.valid("json");
        const d1 = c.env.INVENTORY_DB;
        const { results } = await d1
          .prepare(`SELECT id, name FROM ${table}`)
          .all<{ id: number; name: string }>();
        if (!results.some((row) => row.id === id)) {
          return c.json({ error: `That ${what} no longer exists.` }, 404);
        }
        if (results.some((row) => row.id !== id && sameName(row.name, name))) {
          return c.json({ error: `There's already a ${what} with that name.` }, 409);
        }
        await d1.prepare(`UPDATE ${table} SET name = ?2 WHERE id = ?1`).bind(id, name).run();
        return c.json({ ok: true });
      })
      /** Removes one, unless parts are in use on it. */
      .delete("/:id", requireAdmin, async (c) => {
        const id = parseId(c.req.param("id"));
        if (id === null) return c.json({ ok: true });
        const d1 = c.env.INVENTORY_DB;
        const used = await d1
          .prepare(`SELECT COUNT(DISTINCT item_id) AS n FROM stock WHERE ${column} = ?1`)
          .bind(id)
          .first<{ n: number }>();
        if (used && used.n > 0) {
          return c.json(
            {
              error: `${used.n} ${used.n === 1 ? "entry has" : "entries have"} parts in use on this ${what}. Check them in first.`,
            },
            409,
          );
        }
        await d1.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(id).run();
        return c.json({ ok: true });
      })
  );
}

export const robotsRouter = namedRouter("robots", "robot_id", "robot", MAX_ROBOTS);
export const subsystemsRouter = namedRouter(
  "subsystems",
  "subsystem_id",
  "subsystem",
  MAX_SUBSYSTEMS,
);

// ---- Setup files ----

const setupValidator = validator("json", (value, c) => {
  const parsed = parseSetup(value);
  if ("problems" in parsed) {
    return c.json({ error: "That file can't be loaded.", problems: parsed.problems }, 400) as never;
  }
  return parsed.setup;
});

export const setupRouter = new Hono<AppEnv>()
  /** The team's setup as a file: its fields, locations, robots and subsystems, and no parts. */
  .get("/export", requireAdmin, async (c) =>
    c.json(await exportSetup(createDb(c.env.INVENTORY_DB))),
  )
  /** The setup that comes with the app. */
  .get("/starter", requireAdmin, (c) => c.json(starterSetup()))
  /** What loading a file would add, without adding it. */
  .post("/preview", requireAdmin, setupValidator, async (c) => {
    const d1 = c.env.INVENTORY_DB;
    return c.json(await loadSetup(createDb(d1), d1, c.req.valid("json"), false));
  })
  /** Adds what's in a file that the team doesn't have yet. Nothing is changed or removed. */
  .post("/import", requireAdmin, setupValidator, async (c) => {
    const d1 = c.env.INVENTORY_DB;
    return c.json(await loadSetup(createDb(d1), d1, c.req.valid("json"), true));
  });
