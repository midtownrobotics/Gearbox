import { requireAuth, requireMentor } from "@g3/auth";
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type Db, createDb } from "../db";
import { categoryPrereqs, skillPrereqs, skills, treeCategories, trees } from "../db/schema";
import { idList, parseId, textField } from "../lib/input";
import {
  type TreeSet,
  applyTreeSet,
  currentTreeSet,
  defaultTreeSet,
  exportTreeSet,
  parseTreeSet,
  previewTreeSet,
} from "../lib/tree-set";
import { keyFrom, loadTrees, requiresItself } from "../lib/trees";
import type { AppEnv } from "../types";

// The team's trees. Anyone signed in reads them; mentors (and admins) edit them, one piece at a
// time here or all at once by loading a file (lib/tree-set.ts). Every query is kept to the team's
// tree set.

type TreeFields = {
  name: string;
  subtitle: string;
  icon: string;
  requiresTreeId: number | null;
};

const treeValidator = (partial: boolean) =>
  validator("json", (value, c): Partial<TreeFields> => {
    const v = (value ?? {}) as Record<string, unknown>;
    const fail = (error: string) => c.json({ error }, 400) as never;
    const out: Partial<TreeFields> = {};
    if (!partial || v.name !== undefined) {
      const name = textField(v.name, 60, true);
      if (name === null) return fail("name must be 1–60 characters.");
      out.name = name;
    }
    if (v.subtitle !== undefined) {
      const subtitle = textField(v.subtitle, 120);
      if (subtitle === null) return fail("subtitle must be up to 120 characters.");
      out.subtitle = subtitle;
    }
    if (v.icon !== undefined) {
      const icon = textField(v.icon, 16);
      if (icon === null) return fail("icon must be one emoji.");
      out.icon = icon;
    }
    if (v.requiresTreeId !== undefined) {
      if (
        v.requiresTreeId !== null &&
        !(Number.isInteger(v.requiresTreeId) && (v.requiresTreeId as number) > 0)
      ) {
        return fail("requiresTreeId must be a tree's id or null.");
      }
      out.requiresTreeId = v.requiresTreeId as number | null;
    }
    return out;
  });

const orderValidator = validator("json", (value, c): { ids: number[] } => {
  const ids = idList((value as { ids?: unknown })?.ids, 200);
  if (!ids) return c.json({ error: "ids must be every tree's id, in order." }, 400) as never;
  return { ids };
});

type CategoryFields = { name: string; requires: number[] };

const categoryValidator = (partial: boolean) =>
  validator("json", (value, c): Partial<CategoryFields> => {
    const v = (value ?? {}) as Record<string, unknown>;
    const fail = (error: string) => c.json({ error }, 400) as never;
    const out: Partial<CategoryFields> = {};
    if (!partial || v.name !== undefined) {
      const name = textField(v.name, 60, true);
      if (name === null) return fail("name must be 1–60 characters.");
      out.name = name;
    }
    if (v.requires !== undefined) {
      const requires = idList(v.requires);
      if (!requires) return fail("requires must be a list of category ids.");
      out.requires = requires;
    }
    return out;
  });

type SkillFields = { name: string; summary: string; description: string; requires: number[] };

const skillValidator = (partial: boolean) =>
  validator("json", (value, c): Partial<SkillFields> => {
    const v = (value ?? {}) as Record<string, unknown>;
    const fail = (error: string) => c.json({ error }, 400) as never;
    const out: Partial<SkillFields> = {};
    if (!partial || v.name !== undefined) {
      const name = textField(v.name, 80, true);
      if (name === null) return fail("name must be 1–80 characters.");
      out.name = name;
    }
    if (v.summary !== undefined) {
      const summary = textField(v.summary, 120);
      if (summary === null) return fail("summary must be up to 120 characters.");
      out.summary = summary;
    }
    if (v.description !== undefined) {
      const description = textField(v.description, 2000);
      if (description === null) return fail("description must be up to 2000 characters.");
      out.description = description;
    }
    if (v.requires !== undefined) {
      const requires = idList(v.requires);
      if (!requires) return fail("requires must be a list of skill ids.");
      out.requires = requires;
    }
    return out;
  });

/** A file's contents: checked by `parseTreeSet`, whose findings go back with the 400. */
const treeSetValidator = validator("json", (value, c): TreeSet => {
  const parsed = parseTreeSet(value);
  if ("problems" in parsed) {
    return c.json({ error: "This file can't be loaded.", problems: parsed.problems }, 400) as never;
  }
  return parsed.set;
});

/** The next place at the end of a list: one more than the highest sort order in it. */
const afterLast = (orders: number[]) => (orders.length > 0 ? Math.max(...orders) + 1 : 0);

const treesOf = (db: Db, setId: number) =>
  db
    .select({
      id: trees.id,
      key: trees.key,
      requires: trees.requiresTreeId,
      sortOrder: trees.sortOrder,
    })
    .from(trees)
    .where(eq(trees.treeSetId, setId))
    .all();

/** The category and its tree, if it's in the set. */
const categoryIn = (db: Db, setId: number, id: number | null) =>
  id === null
    ? undefined
    : db
        .select({ id: treeCategories.id, treeId: treeCategories.treeId })
        .from(treeCategories)
        .innerJoin(trees, eq(trees.id, treeCategories.treeId))
        .where(and(eq(treeCategories.id, id), eq(trees.treeSetId, setId)))
        .get();

/** Null if tree `id` (null for a new one) may require `requiresTreeId`; else why not. */
function treeGateProblem(
  rows: { id: number; requires: number | null }[],
  id: number | null,
  requiresTreeId: number,
) {
  if (!rows.some((row) => row.id === requiresTreeId)) return "The required tree doesn't exist.";
  if (id === null) return null;
  const edges = new Map(rows.map((row) => [row.id, row.requires === null ? [] : [row.requires]]));
  return requiresItself(id, [requiresTreeId], edges)
    ? "A tree can't require itself, directly or through other trees."
    : null;
}

/** Null if category `id` (null for a new one) in `treeId` may require `requires`; else why not. */
async function categoryPrereqProblem(
  db: Db,
  treeId: number,
  id: number | null,
  requires: number[],
) {
  if (requires.length === 0) return null;
  const inTree = await db
    .select({ id: treeCategories.id })
    .from(treeCategories)
    .where(eq(treeCategories.treeId, treeId))
    .all();
  const ids = new Set(inTree.map((row) => row.id));
  if (!requires.every((required) => ids.has(required))) {
    return "A category can only require categories in the same tree.";
  }
  if (id === null) return null;
  const links = await db
    .select({ from: categoryPrereqs.categoryId, to: categoryPrereqs.requiresCategoryId })
    .from(categoryPrereqs)
    .innerJoin(treeCategories, eq(treeCategories.id, categoryPrereqs.categoryId))
    .where(eq(treeCategories.treeId, treeId))
    .all();
  const edges = new Map<number, number[]>();
  for (const link of links) edges.set(link.from, [...(edges.get(link.from) ?? []), link.to]);
  return requiresItself(id, requires, edges)
    ? "A category can't require itself, directly or through other categories."
    : null;
}

/** Null if skill `id` (null for a new one) in `categoryId` may require `requires`; else why not. */
async function skillPrereqProblem(
  db: Db,
  categoryId: number,
  id: number | null,
  requires: number[],
) {
  if (requires.length === 0) return null;
  const inCategory = await db
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.categoryId, categoryId))
    .all();
  const ids = new Set(inCategory.map((row) => row.id));
  if (!requires.every((required) => ids.has(required))) {
    return "A skill can only require skills in the same category.";
  }
  if (id === null) return null;
  const links = await db
    .select({ from: skillPrereqs.skillId, to: skillPrereqs.requiresSkillId })
    .from(skillPrereqs)
    .innerJoin(skills, eq(skills.id, skillPrereqs.skillId))
    .where(eq(skills.categoryId, categoryId))
    .all();
  const edges = new Map<number, number[]>();
  for (const link of links) edges.set(link.from, [...(edges.get(link.from) ?? []), link.to]);
  return requiresItself(id, requires, edges)
    ? "A skill can't require itself, directly or through other skills."
    : null;
}

const run = async (db: Db, statements: BatchItem<"sqlite">[]) => {
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
};

export const treesRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createDb(c.env.SKILL_DB);
    const set = await currentTreeSet(db, c.get("teamId"));
    return c.json({
      set: { name: set.name, loadedByName: set.loadedByName, loadedAt: set.loadedAt },
      trees: await loadTrees(db, set.id),
    });
  })
  /** The team's trees as a file, to keep, share, or edit and load again. */
  .get("/export", requireMentor, async (c) => {
    const db = createDb(c.env.SKILL_DB);
    return c.json(await exportTreeSet(db, await currentTreeSet(db, c.get("teamId"))));
  })
  /** The set every team starts with, as a file. */
  .get("/default", requireMentor, (c) => c.json(defaultTreeSet()))
  /**
   * What loading a file would change, without changing anything: what's added and removed, and
   * how many sign-offs go with the removed skills.
   */
  .post("/import/preview", requireMentor, treeSetValidator, async (c) => {
    const db = createDb(c.env.SKILL_DB);
    const summary = await previewTreeSet(
      db,
      await currentTreeSet(db, c.get("teamId")),
      c.req.valid("json"),
    );
    return c.json({ summary });
  })
  /** Loads a file in place of the team's trees. */
  .post("/import", requireMentor, treeSetValidator, async (c) => {
    const db = createDb(c.env.SKILL_DB);
    const summary = await applyTreeSet(
      db,
      await currentTreeSet(db, c.get("teamId")),
      c.req.valid("json"),
      c.get("userDisplayName"),
    );
    return c.json({ summary });
  })
  .post("/", requireMentor, treeValidator(false), async (c) => {
    const body = c.req.valid("json") as Partial<TreeFields> & { name: string };
    const db = createDb(c.env.SKILL_DB);
    const set = await currentTreeSet(db, c.get("teamId"));
    const existing = await treesOf(db, set.id);
    if (body.requiresTreeId) {
      const problem = treeGateProblem(existing, null, body.requiresTreeId);
      if (problem) return c.json({ error: problem }, 400);
    }
    const now = Date.now();
    const row = await db
      .insert(trees)
      .values({
        treeSetId: set.id,
        key: keyFrom(
          body.name,
          existing.map((tree) => tree.key),
        ),
        name: body.name,
        subtitle: body.subtitle ?? "",
        icon: body.icon ?? "",
        requiresTreeId: body.requiresTreeId ?? null,
        sortOrder: afterLast(existing.map((tree) => tree.sortOrder)),
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: trees.id })
      .get();
    return c.json({ id: row.id }, 201);
  })
  /** The order trees are listed in: every tree's id, first to last. */
  .put("/order", requireMentor, orderValidator, async (c) => {
    const { ids } = c.req.valid("json");
    const db = createDb(c.env.SKILL_DB);
    const set = await currentTreeSet(db, c.get("teamId"));
    const existing = await treesOf(db, set.id);
    if (existing.length !== ids.length || !existing.every((row) => ids.includes(row.id))) {
      return c.json({ error: "ids must be every tree's id, in order." }, 400);
    }
    await run(
      db,
      ids.map((id, index) => db.update(trees).set({ sortOrder: index }).where(eq(trees.id, id))),
    );
    return c.json({ ok: true });
  })
  .patch("/:id", requireMentor, treeValidator(true), async (c) => {
    const id = parseId(c.req.param("id"));
    const body = c.req.valid("json");
    if (Object.keys(body).length === 0) return c.json({ error: "Nothing to update." }, 400);
    const db = createDb(c.env.SKILL_DB);
    const set = await currentTreeSet(db, c.get("teamId"));
    if (id !== null && body.requiresTreeId) {
      const problem = treeGateProblem(await treesOf(db, set.id), id, body.requiresTreeId);
      if (problem) return c.json({ error: problem }, 400);
    }
    const row =
      id === null
        ? undefined
        : await db
            .update(trees)
            .set({ ...body, updatedAt: Date.now() })
            .where(and(eq(trees.id, id), eq(trees.treeSetId, set.id)))
            .returning({ id: trees.id })
            .get();
    if (!row) return c.json({ error: "Tree not found." }, 404);
    return c.json({ ok: true });
  })
  /** Deletes the tree with its categories and skills, and everyone's progress on them. */
  .delete("/:id", requireMentor, async (c) => {
    const id = parseId(c.req.param("id"));
    const db = createDb(c.env.SKILL_DB);
    const set = await currentTreeSet(db, c.get("teamId"));
    const row =
      id === null
        ? undefined
        : await db
            .delete(trees)
            .where(and(eq(trees.id, id), eq(trees.treeSetId, set.id)))
            .returning({ id: trees.id })
            .get();
    if (!row) return c.json({ error: "Tree not found." }, 404);
    return c.json({ ok: true });
  })
  .post("/:id/categories", requireMentor, categoryValidator(false), async (c) => {
    const treeId = parseId(c.req.param("id"));
    const body = c.req.valid("json") as Partial<CategoryFields> & { name: string };
    const db = createDb(c.env.SKILL_DB);
    const set = await currentTreeSet(db, c.get("teamId"));
    const tree =
      treeId === null
        ? undefined
        : await db
            .select({ id: trees.id })
            .from(trees)
            .where(and(eq(trees.id, treeId), eq(trees.treeSetId, set.id)))
            .get();
    if (!tree) return c.json({ error: "Tree not found." }, 404);
    const requires = body.requires ?? [];
    const problem = await categoryPrereqProblem(db, tree.id, null, requires);
    if (problem) return c.json({ error: problem }, 400);
    const siblings = await db
      .select({ key: treeCategories.key, sortOrder: treeCategories.sortOrder })
      .from(treeCategories)
      .where(eq(treeCategories.treeId, tree.id))
      .all();
    const row = await db
      .insert(treeCategories)
      .values({
        treeId: tree.id,
        key: keyFrom(
          body.name,
          siblings.map((category) => category.key),
        ),
        name: body.name,
        sortOrder: afterLast(siblings.map((category) => category.sortOrder)),
      })
      .returning({ id: treeCategories.id })
      .get();
    if (requires.length > 0) {
      await db
        .insert(categoryPrereqs)
        .values(requires.map((required) => ({ categoryId: row.id, requiresCategoryId: required })));
    }
    return c.json({ id: row.id }, 201);
  });

export const categoriesRouter = new Hono<AppEnv>()
  .patch("/:id", requireMentor, categoryValidator(true), async (c) => {
    const body = c.req.valid("json");
    if (Object.keys(body).length === 0) return c.json({ error: "Nothing to update." }, 400);
    const db = createDb(c.env.SKILL_DB);
    const set = await currentTreeSet(db, c.get("teamId"));
    const category = await categoryIn(db, set.id, parseId(c.req.param("id")));
    if (!category) return c.json({ error: "Category not found." }, 404);
    const statements: BatchItem<"sqlite">[] = [];
    if (body.name !== undefined) {
      statements.push(
        db
          .update(treeCategories)
          .set({ name: body.name })
          .where(eq(treeCategories.id, category.id)),
      );
    }
    if (body.requires !== undefined) {
      const problem = await categoryPrereqProblem(db, category.treeId, category.id, body.requires);
      if (problem) return c.json({ error: problem }, 400);
      statements.push(
        db.delete(categoryPrereqs).where(eq(categoryPrereqs.categoryId, category.id)),
      );
      if (body.requires.length > 0) {
        statements.push(
          db.insert(categoryPrereqs).values(
            body.requires.map((required) => ({
              categoryId: category.id,
              requiresCategoryId: required,
            })),
          ),
        );
      }
    }
    await run(db, statements);
    return c.json({ ok: true });
  })
  /** Deletes the category with its skills, and everyone's progress on them. */
  .delete("/:id", requireMentor, async (c) => {
    const db = createDb(c.env.SKILL_DB);
    const set = await currentTreeSet(db, c.get("teamId"));
    const category = await categoryIn(db, set.id, parseId(c.req.param("id")));
    if (!category) return c.json({ error: "Category not found." }, 404);
    await db.delete(treeCategories).where(eq(treeCategories.id, category.id));
    return c.json({ ok: true });
  })
  .post("/:id/skills", requireMentor, skillValidator(false), async (c) => {
    const body = c.req.valid("json") as Partial<SkillFields> & { name: string };
    const db = createDb(c.env.SKILL_DB);
    const set = await currentTreeSet(db, c.get("teamId"));
    const category = await categoryIn(db, set.id, parseId(c.req.param("id")));
    if (!category) return c.json({ error: "Category not found." }, 404);
    const requires = body.requires ?? [];
    const problem = await skillPrereqProblem(db, category.id, null, requires);
    if (problem) return c.json({ error: problem }, 400);
    // A skill's key is unique in the whole set; its place in line, only in its category.
    const inSet = await db
      .select({ key: skills.key, categoryId: skills.categoryId, sortOrder: skills.sortOrder })
      .from(skills)
      .where(eq(skills.treeSetId, set.id))
      .all();
    const row = await db
      .insert(skills)
      .values({
        treeSetId: set.id,
        categoryId: category.id,
        key: keyFrom(
          body.name,
          inSet.map((skill) => skill.key),
        ),
        name: body.name,
        summary: body.summary ?? "",
        description: body.description ?? "",
        sortOrder: afterLast(
          inSet.filter((skill) => skill.categoryId === category.id).map((skill) => skill.sortOrder),
        ),
      })
      .returning({ id: skills.id })
      .get();
    if (requires.length > 0) {
      await db
        .insert(skillPrereqs)
        .values(requires.map((required) => ({ skillId: row.id, requiresSkillId: required })));
    }
    return c.json({ id: row.id }, 201);
  });

export const skillsRouter = new Hono<AppEnv>()
  .patch("/:id", requireMentor, skillValidator(true), async (c) => {
    const id = parseId(c.req.param("id"));
    const { requires, ...fields } = c.req.valid("json");
    if (requires === undefined && Object.keys(fields).length === 0) {
      return c.json({ error: "Nothing to update." }, 400);
    }
    const db = createDb(c.env.SKILL_DB);
    const set = await currentTreeSet(db, c.get("teamId"));
    const skill =
      id === null
        ? undefined
        : await db
            .select({ id: skills.id, categoryId: skills.categoryId })
            .from(skills)
            .where(and(eq(skills.id, id), eq(skills.treeSetId, set.id)))
            .get();
    if (!skill) return c.json({ error: "Skill not found." }, 404);
    const statements: BatchItem<"sqlite">[] = [];
    if (Object.keys(fields).length > 0) {
      statements.push(db.update(skills).set(fields).where(eq(skills.id, skill.id)));
    }
    if (requires !== undefined) {
      const problem = await skillPrereqProblem(db, skill.categoryId, skill.id, requires);
      if (problem) return c.json({ error: problem }, 400);
      statements.push(db.delete(skillPrereqs).where(eq(skillPrereqs.skillId, skill.id)));
      if (requires.length > 0) {
        statements.push(
          db
            .insert(skillPrereqs)
            .values(requires.map((required) => ({ skillId: skill.id, requiresSkillId: required }))),
        );
      }
    }
    await run(db, statements);
    return c.json({ ok: true });
  })
  /** Deletes the skill and everyone's progress on it. */
  .delete("/:id", requireMentor, async (c) => {
    const id = parseId(c.req.param("id"));
    const db = createDb(c.env.SKILL_DB);
    const set = await currentTreeSet(db, c.get("teamId"));
    const row =
      id === null
        ? undefined
        : await db
            .delete(skills)
            .where(and(eq(skills.id, id), eq(skills.treeSetId, set.id)))
            .returning({ id: skills.id })
            .get();
    if (!row) return c.json({ error: "Skill not found." }, 404);
    return c.json({ ok: true });
  });
