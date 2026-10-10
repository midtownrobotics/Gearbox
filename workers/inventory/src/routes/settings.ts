import { inTeam, requireAdmin, withTeam } from "@g3/auth";
import { eq, gt, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type Db, createDb } from "../db";
import {
  FIELD_TYPES,
  type FieldType,
  fields,
  locations,
  robots,
  stock,
  subsystems,
} from "../db/schema";
import { parseOptions } from "../lib/fields";
import { chunks, parseId, sameName, textField } from "../lib/input";
import { MAX_DEPTH, depthOf, indexLocations, loadLocations, subtreeOf } from "../lib/locations";
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

type Ordered = typeof fields | typeof locations | typeof robots | typeof subsystems;

/** Puts the team's rows of a list in the order of `ids` (others' ids change nothing). */
async function reorder(db: Db, team: string, table: Ordered, ids: number[]) {
  const [first, ...rest] = ids.map((id, i) =>
    db
      .update(table)
      .set({ sortOrder: i })
      .where(inTeam(table, team, eq(table.id, id))),
  );
  if (first) await db.batch([first, ...rest]);
}

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
    const team = c.get("teamId");
    const have = await db.select().from(fields).where(inTeam(fields, team)).all();
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
      .values(
        withTeam(team, {
          name: body.name ?? "",
          type: body.type ?? "text",
          options: JSON.stringify(options),
          showInTable: body.showInTable === false ? 0 : 1,
          sortOrder: have.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1,
          createdAt: Date.now(),
        }),
      )
      .returning({ id: fields.id })
      .get();
    return c.json({ id: made.id }, 201);
  })
  .put("/order", requireAdmin, orderValidator, async (c) => {
    await reorder(createDb(c.env.INVENTORY_DB), c.get("teamId"), fields, c.req.valid("json").ids);
    return c.json({ ok: true });
  })
  /** Renames a field, changes its choices or whether the table shows it. Its type stays. */
  .patch("/:id", requireAdmin, fieldValidator(true), async (c) => {
    const id = parseId(c.req.param("id"));
    const body = c.req.valid("json");
    const db = createDb(c.env.INVENTORY_DB);
    const team = c.get("teamId");
    const have = await db.select().from(fields).where(inTeam(fields, team)).all();
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
      .where(inTeam(fields, team, eq(fields.id, row.id)));
    return c.json({ ok: true });
  })
  /** Removes a field. What entries had in it stops showing, and goes when they're next saved. */
  .delete("/:id", requireAdmin, async (c) => {
    const id = parseId(c.req.param("id"));
    if (id !== null) {
      await createDb(c.env.INVENTORY_DB)
        .delete(fields)
        .where(inTeam(fields, c.get("teamId"), eq(fields.id, id)));
    }
    return c.json({ ok: true });
  });

// ---- Locations ----

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
    const team = c.get("teamId");
    const rows = await loadLocations(db, team);
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
    const last = await db
      .select({ next: sql<number>`coalesce(max(${locations.sortOrder}), -1) + 1` })
      .from(locations)
      .where(inTeam(locations, team))
      .get();
    const start = last?.next ?? 0;
    const [first, ...rest] = adding.map((name, i) =>
      db
        .insert(locations)
        .values(withTeam(team, { parentId, name, sortOrder: start + i, createdAt: now })),
    );
    if (first) await db.batch([first, ...rest]);
    return c.json({ added: adding.length, skipped: names.length - adding.length }, 201);
  })
  .put("/order", requireAdmin, orderValidator, async (c) => {
    await reorder(
      createDb(c.env.INVENTORY_DB),
      c.get("teamId"),
      locations,
      c.req.valid("json").ids,
    );
    return c.json({ ok: true });
  })
  /** Renames a location, or moves it (with everything inside) to another place in the tree. */
  .patch("/:id", requireAdmin, editLocationValidator, async (c) => {
    const id = parseId(c.req.param("id"));
    const body = c.req.valid("json");
    const db = createDb(c.env.INVENTORY_DB);
    const team = c.get("teamId");
    const { byId, childrenOf } = indexLocations(await loadLocations(db, team));
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
    await db
      .update(locations)
      .set({ name, parentId })
      .where(inTeam(locations, team, eq(locations.id, row.id)));
    return c.json({ ok: true });
  })
  /** Removes a location and everything inside it, if no parts are kept there. */
  .delete("/:id", requireAdmin, async (c) => {
    const id = parseId(c.req.param("id"));
    if (id === null) return c.json({ ok: true });
    const db = createDb(c.env.INVENTORY_DB);
    const team = c.get("teamId");
    const { byId, childrenOf } = indexLocations(await loadLocations(db, team));
    if (!byId.has(id)) return c.json({ ok: true });
    // The location and everything inside it, in groups that keep each statement under D1's 100
    // bound parameters.
    const groups = chunks(subtreeOf(id, childrenOf), 90);
    const held = new Set<number>();
    for (const group of groups) {
      const rows = await db
        .selectDistinct({ itemId: stock.itemId })
        .from(stock)
        .where(inTeam(stock, team, gt(stock.quantity, 0), inArray(stock.locationId, group)))
        .all();
      for (const row of rows) held.add(row.itemId);
    }
    if (held.size > 0) {
      return c.json(
        {
          error: `${held.size} ${held.size === 1 ? "entry has" : "entries have"} parts there. Move them first.`,
        },
        409,
      );
    }
    const statements: BatchItem<"sqlite">[] = [
      // Empty rows that only remember where an entry lived...
      ...groups.map((group) =>
        db
          .delete(stock)
          .where(inTeam(stock, team, eq(stock.quantity, 0), inArray(stock.locationId, group))),
      ),
      // ...then the locations. Parts put there since fail this (stock points at its location).
      ...groups.map((group) =>
        db.delete(locations).where(inTeam(locations, team, inArray(locations.id, group))),
      ),
    ];
    try {
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
    } catch (err) {
      console.error("[inventory] delete location", err);
      return c.json({ error: "Parts were just put there. Move them first." }, 409);
    }
    return c.json({ ok: true });
  });

// ---- Robots and subsystems: what parts in use are in use on ----

function namedRouter(table: typeof robots | typeof subsystems, what: string, max: number) {
  // The stock column that points at this list.
  const usedBy = table === robots ? stock.robotId : stock.subsystemId;
  return (
    new Hono<AppEnv>()
      .post("/", requireAdmin, nameValidator, async (c) => {
        const { name } = c.req.valid("json");
        const db = createDb(c.env.INVENTORY_DB);
        const team = c.get("teamId");
        const results = await db
          .select({ name: table.name, sortOrder: table.sortOrder })
          .from(table)
          .where(inTeam(table, team))
          .all();
        if (results.length >= max) {
          return c.json({ error: `There can be at most ${max} ${what}s.` }, 400);
        }
        if (results.some((row) => sameName(row.name, name))) {
          return c.json({ error: `There's already a ${what} with that name.` }, 409);
        }
        const next = results.reduce((top, row) => Math.max(top, row.sortOrder), -1) + 1;
        const made = await db
          .insert(table)
          .values(withTeam(team, { name, sortOrder: next, createdAt: Date.now() }))
          .returning({ id: table.id })
          .get();
        return c.json({ id: made.id }, 201);
      })
      .put("/order", requireAdmin, orderValidator, async (c) => {
        await reorder(
          createDb(c.env.INVENTORY_DB),
          c.get("teamId"),
          table,
          c.req.valid("json").ids,
        );
        return c.json({ ok: true });
      })
      .patch("/:id", requireAdmin, nameValidator, async (c) => {
        const id = parseId(c.req.param("id"));
        const { name } = c.req.valid("json");
        const db = createDb(c.env.INVENTORY_DB);
        const team = c.get("teamId");
        const results = await db
          .select({ id: table.id, name: table.name })
          .from(table)
          .where(inTeam(table, team))
          .all();
        if (id === null || !results.some((row) => row.id === id)) {
          return c.json({ error: `That ${what} no longer exists.` }, 404);
        }
        if (results.some((row) => row.id !== id && sameName(row.name, name))) {
          return c.json({ error: `There's already a ${what} with that name.` }, 409);
        }
        await db
          .update(table)
          .set({ name })
          .where(inTeam(table, team, eq(table.id, id)));
        return c.json({ ok: true });
      })
      /** Removes one, unless parts are in use on it. */
      .delete("/:id", requireAdmin, async (c) => {
        const id = parseId(c.req.param("id"));
        if (id === null) return c.json({ ok: true });
        const db = createDb(c.env.INVENTORY_DB);
        const team = c.get("teamId");
        const used = await db
          .selectDistinct({ itemId: stock.itemId })
          .from(stock)
          .where(inTeam(stock, team, eq(usedBy, id)))
          .all();
        if (used.length > 0) {
          return c.json(
            {
              error: `${used.length} ${used.length === 1 ? "entry has" : "entries have"} parts in use on this ${what}. Check them in first.`,
            },
            409,
          );
        }
        await db.delete(table).where(inTeam(table, team, eq(table.id, id)));
        return c.json({ ok: true });
      })
  );
}

export const robotsRouter = namedRouter(robots, "robot", MAX_ROBOTS);
export const subsystemsRouter = namedRouter(subsystems, "subsystem", MAX_SUBSYSTEMS);

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
    c.json(await exportSetup(createDb(c.env.INVENTORY_DB), c.get("teamId"))),
  )
  /** The setup that comes with the app. */
  .get("/starter", requireAdmin, (c) => c.json(starterSetup()))
  /** What loading a file would add, without adding it. */
  .post("/preview", requireAdmin, setupValidator, async (c) =>
    c.json(
      await loadSetup(createDb(c.env.INVENTORY_DB), c.get("teamId"), c.req.valid("json"), false),
    ),
  )
  /** Adds what's in a file that the team doesn't have yet. Nothing is changed or removed. */
  .post("/import", requireAdmin, setupValidator, async (c) =>
    c.json(
      await loadSetup(createDb(c.env.INVENTORY_DB), c.get("teamId"), c.req.valid("json"), true),
    ),
  );
