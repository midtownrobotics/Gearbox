import { asc, eq } from "drizzle-orm";
import type { Db } from "../db";
import { categoryPrereqs, skillPrereqs, skills, treeCategories, trees } from "../db/schema";

export type SkillView = {
  id: number;
  name: string;
  summary: string;
  description: string;
  /** Skills in the same category that must be complete first. */
  requires: number[];
};

export type CategoryView = {
  id: number;
  name: string;
  /** Categories in the same tree that must be complete first. */
  requires: number[];
  skills: SkillView[];
};

export type TreeView = {
  id: number;
  name: string;
  subtitle: string;
  icon: string;
  /** The tree that must be complete before this one opens. */
  requiresTreeId: number | null;
  categories: CategoryView[];
};

function grouped(rows: { from: number; to: number }[]) {
  const out = new Map<number, number[]>();
  for (const row of rows) {
    const list = out.get(row.from);
    if (list) list.push(row.to);
    else out.set(row.from, [row.to]);
  }
  return out;
}

/** Every row of a tree set, in display order, with what each category and skill requires. */
export async function loadSetRows(db: Db, setId: number) {
  const [treeRows, categoryRows, categoryPrereqRows, skillRows, skillPrereqRows] =
    await Promise.all([
      db
        .select()
        .from(trees)
        .where(eq(trees.treeSetId, setId))
        .orderBy(asc(trees.sortOrder), asc(trees.id))
        .all(),
      db
        .select({
          id: treeCategories.id,
          treeId: treeCategories.treeId,
          key: treeCategories.key,
          name: treeCategories.name,
        })
        .from(treeCategories)
        .innerJoin(trees, eq(trees.id, treeCategories.treeId))
        .where(eq(trees.treeSetId, setId))
        .orderBy(asc(treeCategories.sortOrder), asc(treeCategories.id))
        .all(),
      db
        .select({ from: categoryPrereqs.categoryId, to: categoryPrereqs.requiresCategoryId })
        .from(categoryPrereqs)
        .innerJoin(treeCategories, eq(treeCategories.id, categoryPrereqs.categoryId))
        .innerJoin(trees, eq(trees.id, treeCategories.treeId))
        .where(eq(trees.treeSetId, setId))
        .all(),
      db
        .select()
        .from(skills)
        .where(eq(skills.treeSetId, setId))
        .orderBy(asc(skills.sortOrder), asc(skills.id))
        .all(),
      db
        .select({ from: skillPrereqs.skillId, to: skillPrereqs.requiresSkillId })
        .from(skillPrereqs)
        .innerJoin(skills, eq(skills.id, skillPrereqs.skillId))
        .where(eq(skills.treeSetId, setId))
        .all(),
    ]);
  return {
    treeRows,
    categoryRows,
    skillRows,
    categoryRequires: grouped(categoryPrereqRows),
    skillRequires: grouped(skillPrereqRows),
  };
}

/** The set's trees with their categories and skills, as the page shows them. */
export async function loadTrees(db: Db, setId: number): Promise<TreeView[]> {
  const rows = await loadSetRows(db, setId);

  const skillsByCategory = new Map<number, SkillView[]>();
  for (const skill of rows.skillRows) {
    const view: SkillView = {
      id: skill.id,
      name: skill.name,
      summary: skill.summary,
      description: skill.description,
      requires: rows.skillRequires.get(skill.id) ?? [],
    };
    const list = skillsByCategory.get(skill.categoryId);
    if (list) list.push(view);
    else skillsByCategory.set(skill.categoryId, [view]);
  }

  const categoriesByTree = new Map<number, CategoryView[]>();
  for (const category of rows.categoryRows) {
    const view: CategoryView = {
      id: category.id,
      name: category.name,
      requires: rows.categoryRequires.get(category.id) ?? [],
      skills: skillsByCategory.get(category.id) ?? [],
    };
    const list = categoriesByTree.get(category.treeId);
    if (list) list.push(view);
    else categoriesByTree.set(category.treeId, [view]);
  }

  return rows.treeRows.map((tree) => ({
    id: tree.id,
    name: tree.name,
    subtitle: tree.subtitle,
    icon: tree.icon,
    requiresTreeId: tree.requiresTreeId,
    categories: categoriesByTree.get(tree.id) ?? [],
  }));
}

/**
 * Whether making `id` require `requires` would make it (indirectly) require itself. `edges` is
 * what every other item requires now. A loop could never be unlocked, and can't be drawn.
 */
export function requiresItself(
  id: number,
  requires: number[],
  edges: Map<number, number[]>,
): boolean {
  const seen = new Set<number>();
  const queue = [...requires];
  while (queue.length > 0) {
    const next = queue.pop() as number;
    if (next === id) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(edges.get(next) ?? []));
  }
  return false;
}

/**
 * A key for something made in the app, from its name ("Camera basics" → "camera-basics"), with a
 * number added if that one is `taken`. Keys only show up in saved files.
 */
export function keyFrom(name: string, taken: Iterable<string>): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .slice(0, 32)
      .replace(/^-+|-+$/g, "") || "item";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const key = `${base}-${n}`;
    if (!used.has(key)) return key;
  }
}
