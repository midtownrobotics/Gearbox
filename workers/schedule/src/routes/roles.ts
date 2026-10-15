import { inTeam, requireAuth, withTeam } from "@g3/auth";
import { asc, eq, isNull, max, ne } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type Db, createDb } from "../db";
import { assignments, roles } from "../db/schema";
import { requireEditor } from "../lib/editors";
import { nowSeconds, parseId, sameName, textField } from "../lib/input";
import {
  MAX_ROLES,
  MAX_ROLE_NAME,
  ROLE_COLORS,
  type RoleColor,
  isRoleColor,
  normalizeRoleColor,
} from "../lib/roles";
import { roleView } from "../lib/schedules";
import type { AppEnv } from "../types";

// The team's own roles (Drive Team, Scouting, Pit, Break, Lunch), kept from event to event.
// Everyone signed in reads them; editors make and change them. A role that's assigned anywhere
// is archived instead of deleted, so past schedules keep it.

type RoleInput = { name?: string; color?: RoleColor; archived?: boolean };

const roleValidator = (partial: boolean) =>
  validator("json", (value, c): RoleInput => {
    const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const fail = (error: string) => c.json({ error }, 400) as never;
    const out: RoleInput = {};
    if (!partial || v.name !== undefined) {
      const name = textField(v.name, MAX_ROLE_NAME, true);
      if (name === null) return fail(`name must be 1–${MAX_ROLE_NAME} characters.`);
      out.name = name;
    }
    if (!partial || v.color !== undefined) {
      if (!isRoleColor(v.color)) {
        return fail(`color must be #rrggbb or one of: ${ROLE_COLORS.join(", ")}.`);
      }
      out.color = normalizeRoleColor(v.color);
    }
    if (partial && v.archived !== undefined) {
      if (typeof v.archived !== "boolean") return fail("archived must be true or false.");
      out.archived = v.archived;
    }
    return out;
  });

/** Whether another of the team's roles in use (not archived) already has this name. */
async function nameTaken(db: Db, team: string, name: string, except?: number) {
  const others = await db
    .select({ name: roles.name })
    .from(roles)
    .where(
      inTeam(
        roles,
        team,
        isNull(roles.archivedAt),
        except === undefined ? undefined : ne(roles.id, except),
      ),
    )
    .all();
  return others.some((other) => sameName(other.name, name));
}

const findRole = (db: Db, team: string, id: number) =>
  db
    .select()
    .from(roles)
    .where(inTeam(roles, team, eq(roles.id, id)))
    .get();

export const rolesRouter = new Hono<AppEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const rows = await createDb(c.env.SCHEDULE_DB)
      .select()
      .from(roles)
      .where(inTeam(roles, c.get("teamId")))
      .orderBy(asc(roles.sortOrder), asc(roles.id))
      .all();
    return c.json(rows.map(roleView));
  })
  .post("/", requireEditor, roleValidator(false), async (c) => {
    const team = c.get("teamId");
    const input = c.req.valid("json") as Required<Omit<RoleInput, "archived">>;
    const db = createDb(c.env.SCHEDULE_DB);
    const [count, last] = await db.batch([
      db.select({ id: roles.id }).from(roles).where(inTeam(roles, team)),
      db
        .select({ order: max(roles.sortOrder) })
        .from(roles)
        .where(inTeam(roles, team)),
    ]);
    if (count.length >= MAX_ROLES) {
      return c.json(
        { error: `A team has at most ${MAX_ROLES} roles. Delete unused ones first.` },
        400,
      );
    }
    if (await nameTaken(db, team, input.name)) {
      return c.json({ error: `There's already a role called ${input.name}.` }, 409);
    }
    const row = await db
      .insert(roles)
      .values(
        withTeam(team, {
          name: input.name,
          color: input.color,
          sortOrder: (last[0]?.order ?? -1) + 1,
          createdAt: nowSeconds(),
        }),
      )
      .returning()
      .get();
    return c.json(roleView(row), 201);
  })
  .put(
    "/order",
    requireEditor,
    validator("json", (value, c): { ids: number[] } => {
      const raw = (value as Record<string, unknown> | null)?.ids;
      const ids = Array.isArray(raw) ? raw.map(parseId) : [];
      if (ids.length === 0 || ids.length > MAX_ROLES || ids.includes(null)) {
        return c.json({ error: `ids must be a list of 1–${MAX_ROLES} role ids.` }, 400) as never;
      }
      return { ids: [...new Set(ids as number[])] };
    }),
    async (c) => {
      const team = c.get("teamId");
      const db = createDb(c.env.SCHEDULE_DB);
      const [first, ...rest] = c.req.valid("json").ids.map((id, i) =>
        db
          .update(roles)
          .set({ sortOrder: i })
          .where(inTeam(roles, team, eq(roles.id, id))),
      );
      await db.batch([first, ...rest]);
      return c.json({ ok: true });
    },
  )
  // Renames, recolors, archives (hidden from new assignments, kept on past ones) or brings back.
  .patch("/:roleId", requireEditor, roleValidator(true), async (c) => {
    const team = c.get("teamId");
    const id = parseId(c.req.param("roleId"));
    const db = createDb(c.env.SCHEDULE_DB);
    const role = id === null ? undefined : await findRole(db, team, id);
    if (!role || id === null) return c.json({ error: "No such role." }, 404);
    const input = c.req.valid("json");
    const archived = input.archived ?? role.archivedAt !== null;
    const name = input.name ?? role.name;
    if (!archived && (await nameTaken(db, team, name, id))) {
      return c.json({ error: `There's already a role called ${name}.` }, 409);
    }
    const row = await db
      .update(roles)
      .set({
        name,
        color: input.color ?? role.color,
        archivedAt: archived ? (role.archivedAt ?? nowSeconds()) : null,
      })
      .where(inTeam(roles, team, eq(roles.id, id)))
      .returning()
      .get();
    return c.json(roleView(row));
  })
  // Only a role nobody has been given: one that's in a schedule is archived instead.
  .delete("/:roleId", requireEditor, async (c) => {
    const team = c.get("teamId");
    const id = parseId(c.req.param("roleId"));
    const db = createDb(c.env.SCHEDULE_DB);
    if (id === null || !(await findRole(db, team, id))) {
      return c.json({ error: "No such role." }, 404);
    }
    const used = await db
      .select({ roleId: assignments.roleId })
      .from(assignments)
      .where(inTeam(assignments, team, eq(assignments.roleId, id)))
      .limit(1)
      .get();
    if (used) {
      return c.json({ error: "It's assigned in a schedule. Archive it instead." }, 409);
    }
    await db.delete(roles).where(inTeam(roles, team, eq(roles.id, id)));
    return c.json({ ok: true });
  });
