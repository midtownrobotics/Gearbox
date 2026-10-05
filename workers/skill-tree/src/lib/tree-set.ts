import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import defaultTrees from "../../content/default-trees.json";
import type { Db } from "../db";
import {
  categoryPrereqs,
  skillPrereqs,
  skillProgress,
  skills,
  treeCategories,
  treeSets,
  trees,
} from "../db/schema";
import { chunks } from "./input";
import { loadSetRows } from "./trees";

// A tree set: all of a team's trees as one file. The app itself holds no trees. A team starts
// from the default set (content/default-trees.json), edits it in the app, and can save its set to
// a file or load one in its place. Everything in a file is named by a key, and loading matches
// rows by those keys: what's still in the file keeps everyone's progress, what's gone is deleted.

export const TREE_SET_FORMAT = "gearbox-skill-trees";
export const TREE_SET_VERSION = 1;

export type TreeSetSkill = {
  /** Unique in the whole file. */
  key: string;
  name: string;
  summary: string;
  description: string;
  /** Keys of skills in the same category that must be complete first. */
  requires: string[];
};

export type TreeSetCategory = {
  /** Unique in its tree. */
  key: string;
  name: string;
  /** Keys of categories in the same tree that must be complete first. */
  requires: string[];
  skills: TreeSetSkill[];
};

export type TreeSetTree = {
  /** Unique in the file. */
  key: string;
  name: string;
  /** An emoji. */
  icon: string;
  subtitle: string;
  /** The key of the tree that must be complete before this one opens. */
  requires: string | null;
  categories: TreeSetCategory[];
};

export type TreeSet = {
  format: typeof TREE_SET_FORMAT;
  version: typeof TREE_SET_VERSION;
  name: string;
  trees: TreeSetTree[];
};

const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const MAX_TREES = 40;
const MAX_CATEGORIES = 40;
const MAX_SKILLS_IN_CATEGORY = 80;
const MAX_SKILLS = 2000;
const MAX_PROBLEMS = 25;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A key that (indirectly) requires itself, if there is one. */
function loopIn(requires: Map<string, string[]>): string | null {
  const done = new Set<string>();
  const open = new Set<string>();
  const visit = (key: string): boolean => {
    if (done.has(key)) return false;
    if (open.has(key)) return true;
    open.add(key);
    for (const next of requires.get(key) ?? []) if (visit(next)) return true;
    open.delete(key);
    done.add(key);
    return false;
  };
  for (const key of requires.keys()) if (visit(key)) return key;
  return null;
}

/**
 * Checks a file's contents. Gives back the set with every optional field filled in, or what's
 * wrong with it, in words a mentor can act on.
 */
export function parseTreeSet(input: unknown): { set: TreeSet } | { problems: string[] } {
  if (!isObject(input) || input.format !== TREE_SET_FORMAT) {
    return {
      problems: [`This isn't a skill trees file: its "format" must be "${TREE_SET_FORMAT}".`],
    };
  }
  if (input.version !== TREE_SET_VERSION) {
    return {
      problems: [
        `This file is version ${String(input.version)}. Only version ${TREE_SET_VERSION} can be loaded.`,
      ],
    };
  }

  const problems: string[] = [];
  const fail = (where: string, what: string) => problems.push(where ? `${where}: ${what}` : what);

  const text = (value: unknown, max: number, where: string, field: string, required = false) => {
    if (value === undefined || value === null) {
      if (required) fail(where, `${field} is missing.`);
      return "";
    }
    if (typeof value !== "string") {
      fail(where, `${field} must be text.`);
      return "";
    }
    const trimmed = value.trim();
    if (required && !trimmed) fail(where, `${field} is empty.`);
    if (trimmed.length > max) fail(where, `${field} is longer than ${max} characters.`);
    return trimmed;
  };
  const key = (value: unknown, where: string) => {
    if (typeof value === "string" && KEY.test(value)) return value;
    fail(where, `"key" must be 1–40 letters, digits, "-" or "_", starting with a letter or digit.`);
    return "";
  };
  const keyList = (value: unknown, where: string) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      fail(where, `"requires" must be a list of keys.`);
      return [];
    }
    return [...new Set(value as string[])];
  };
  const list = (value: unknown, max: number, where: string, field: string) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      fail(where, `"${field}" must be a list.`);
      return [];
    }
    if (value.length > max) {
      fail(where, `"${field}" has more than ${max} entries.`);
      return [];
    }
    return value as unknown[];
  };
  /**
   * Reports a key that requires itself, something not in the map (which holds everything in
   * `place`), or itself in a loop.
   */
  const checkRequires = (
    where: (key: string) => string,
    place: string,
    requires: Map<string, string[]>,
  ) => {
    let sound = true;
    for (const [from, keys] of requires) {
      for (const to of keys) {
        if (to === from) fail(where(from), "it can't require itself.");
        else if (!requires.has(to))
          fail(where(from), `it requires "${to}", which isn't in ${place}.`);
        else continue;
        sound = false;
      }
    }
    const loop = sound ? loopIn(requires) : null;
    if (loop) fail(where(loop), "it requires itself through the things it requires.");
  };

  const out: TreeSetTree[] = [];
  const skillKeys = new Set<string>();
  const treeKeys = new Set<string>();

  list(input.trees, MAX_TREES, "", "trees").forEach((rawTree, treeIndex) => {
    const tree = isObject(rawTree) ? rawTree : {};
    const treeName = typeof tree.name === "string" && tree.name.trim() ? tree.name.trim() : null;
    const inTree = `Tree ${treeName ? `“${treeName}”` : treeIndex + 1}`;
    const treeKey = key(tree.key, inTree);
    if (treeKey && treeKeys.has(treeKey)) fail(inTree, `another tree has the key "${treeKey}".`);
    treeKeys.add(treeKey);
    const requires = tree.requires;
    if (requires !== undefined && requires !== null && typeof requires !== "string") {
      fail(inTree, `"requires" must be one tree's key, or left out.`);
    }

    const categories: TreeSetCategory[] = [];
    const categoryKeys = new Set<string>();
    list(tree.categories, MAX_CATEGORIES, inTree, "categories").forEach((rawCategory, i) => {
      const category = isObject(rawCategory) ? rawCategory : {};
      const categoryName =
        typeof category.name === "string" && category.name.trim() ? category.name.trim() : null;
      const inCategory = `${inTree}, category ${categoryName ? `“${categoryName}”` : i + 1}`;
      const categoryKey = key(category.key, inCategory);
      if (categoryKey && categoryKeys.has(categoryKey)) {
        fail(inCategory, `another category in this tree has the key "${categoryKey}".`);
      }
      categoryKeys.add(categoryKey);

      const categorySkills: TreeSetSkill[] = [];
      const requiresOf = new Map<string, string[]>();
      list(category.skills, MAX_SKILLS_IN_CATEGORY, inCategory, "skills").forEach((rawSkill, j) => {
        const skill = isObject(rawSkill) ? rawSkill : {};
        const skillName =
          typeof skill.name === "string" && skill.name.trim() ? skill.name.trim() : null;
        const inSkill = `${inCategory}, skill ${skillName ? `“${skillName}”` : j + 1}`;
        const skillKey = key(skill.key, inSkill);
        if (skillKey && skillKeys.has(skillKey)) {
          fail(inSkill, `another skill in the file has the key "${skillKey}".`);
        }
        skillKeys.add(skillKey);
        const parsed: TreeSetSkill = {
          key: skillKey,
          name: text(skill.name, 80, inSkill, "name", true),
          summary: text(skill.summary, 120, inSkill, "summary"),
          description: text(skill.description, 2000, inSkill, "description"),
          requires: keyList(skill.requires, inSkill),
        };
        categorySkills.push(parsed);
        requiresOf.set(skillKey, parsed.requires);
      });
      checkRequires((skillKey) => `${inCategory}, skill "${skillKey}"`, "its category", requiresOf);

      categories.push({
        key: categoryKey,
        name: text(category.name, 60, inCategory, "name", true),
        requires: keyList(category.requires, inCategory),
        skills: categorySkills,
      });
    });
    checkRequires(
      (categoryKey) => `${inTree}, category "${categoryKey}"`,
      "its tree",
      new Map(categories.map((category) => [category.key, category.requires])),
    );

    out.push({
      key: treeKey,
      name: text(tree.name, 60, inTree, "name", true),
      icon: text(tree.icon, 16, inTree, "icon"),
      subtitle: text(tree.subtitle, 120, inTree, "subtitle"),
      requires: typeof requires === "string" ? requires : null,
      categories,
    });
  });

  const name = text(input.name, 80, "", `The file's name`) || "Custom skill trees";
  if (out.length === 0 && problems.length === 0) fail("", "The file has no trees.");
  if (skillKeys.size > MAX_SKILLS) fail("", `The file has more than ${MAX_SKILLS} skills.`);
  checkRequires(
    (treeKey) => `Tree "${treeKey}"`,
    "the file",
    new Map(out.map((tree) => [tree.key, tree.requires ? [tree.requires] : []])),
  );

  if (problems.length > 0) {
    const more = problems.length - MAX_PROBLEMS;
    return {
      problems: more > 0 ? [...problems.slice(0, MAX_PROBLEMS), `…and ${more} more.`] : problems,
    };
  }
  return {
    set: {
      format: TREE_SET_FORMAT,
      version: TREE_SET_VERSION,
      name,
      trees: out,
    },
  };
}

let parsedDefault: TreeSet | null = null;

/** The set a team starts with. */
export function defaultTreeSet(): TreeSet {
  if (!parsedDefault) {
    const parsed = parseTreeSet(defaultTrees);
    if ("problems" in parsed) {
      throw new Error(`content/default-trees.json: ${parsed.problems.join(" ")}`);
    }
    parsedDefault = parsed.set;
  }
  return parsedDefault;
}

export type TreeSetRow = typeof treeSets.$inferSelect;

const firstSet = (db: Db) => db.select().from(treeSets).orderBy(asc(treeSets.id)).limit(1).get();

/**
 * The team's tree set. The first time anyone asks, it's made from the default set: the app's
 * stand-in for the "seed" step a team will go through when it switches the app on (roadmap 4.3).
 */
export async function currentTreeSet(db: Db): Promise<TreeSetRow> {
  const existing = await firstSet(db);
  if (existing) return existing;

  const starter = defaultTreeSet();
  // Only one of two first requests at once gets to make the row, and so to fill it.
  const made = await db.all<{ id: number }>(
    sql`insert into tree_sets (name, loaded_at)
        select ${starter.name}, ${Date.now()} where not exists (select 1 from tree_sets)
        returning id`,
  );
  const row = await firstSet(db);
  if (!row) throw new Error("The tree set couldn't be made.");
  if (made.length === 0) return row;
  await applyTreeSet(db, row, starter, null);
  return (await firstSet(db)) ?? row;
}

/** The set as a file. */
export async function exportTreeSet(db: Db, row: TreeSetRow): Promise<TreeSet> {
  const rows = await loadSetRows(db, row.id);
  const treeKey = new Map(rows.treeRows.map((tree) => [tree.id, tree.key]));
  const categoryKey = new Map(rows.categoryRows.map((category) => [category.id, category.key]));
  const skillKey = new Map(rows.skillRows.map((skill) => [skill.id, skill.key]));
  const keysOf = (ids: number[] | undefined, keys: Map<number, string>) =>
    (ids ?? []).map((id) => keys.get(id)).filter((key): key is string => key !== undefined);

  return {
    format: TREE_SET_FORMAT,
    version: TREE_SET_VERSION,
    name: row.name,
    trees: rows.treeRows.map((tree) => ({
      key: tree.key,
      name: tree.name,
      icon: tree.icon,
      subtitle: tree.subtitle,
      requires: (tree.requiresTreeId !== null && treeKey.get(tree.requiresTreeId)) || null,
      categories: rows.categoryRows
        .filter((category) => category.treeId === tree.id)
        .map((category) => ({
          key: category.key,
          name: category.name,
          requires: keysOf(rows.categoryRequires.get(category.id), categoryKey),
          skills: rows.skillRows
            .filter((skill) => skill.categoryId === category.id)
            .map((skill) => ({
              key: skill.key,
              name: skill.name,
              summary: skill.summary,
              description: skill.description,
              requires: keysOf(rows.skillRequires.get(skill.id), skillKey),
            })),
        })),
    })),
  };
}

type Change = { total: number; added: number; removed: number };

/** What loading a file changes. */
export type LoadSummary = {
  trees: Change;
  categories: Change;
  skills: Change;
  /** Sign-offs on skills the file doesn't have, which loading it deletes. */
  progressRemoved: number;
};

/** What loading `set` would add and remove, and the rows it would delete. */
async function plan(db: Db, row: TreeSetRow, set: TreeSet) {
  const rows = await loadSetRows(db, row.id);
  const treeKeyOf = new Map(rows.treeRows.map((tree) => [tree.id, tree.key]));

  const fileTrees = new Set(set.trees.map((tree) => tree.key));
  const fileCategories = new Set(
    set.trees.flatMap((tree) => tree.categories.map((category) => `${tree.key}/${category.key}`)),
  );
  const fileSkills = new Set(
    set.trees.flatMap((tree) =>
      tree.categories.flatMap((category) => category.skills.map((skill) => skill.key)),
    ),
  );
  const haveTrees = new Set(rows.treeRows.map((tree) => tree.key));
  const categoryPath = (category: { treeId: number; key: string }) =>
    `${treeKeyOf.get(category.treeId)}/${category.key}`;
  const haveCategories = new Set(rows.categoryRows.map(categoryPath));
  const haveSkills = new Set(rows.skillRows.map((skill) => skill.key));

  const gone = {
    treeIds: rows.treeRows.filter((tree) => !fileTrees.has(tree.key)).map((tree) => tree.id),
    categoryIds: rows.categoryRows
      .filter((category) => !fileCategories.has(categoryPath(category)))
      .map((category) => category.id),
    skillIds: rows.skillRows.filter((skill) => !fileSkills.has(skill.key)).map((skill) => skill.id),
  };

  let progressRemoved = 0;
  for (const ids of chunks(gone.skillIds, 90)) {
    const counted = await db
      .select({ count: sql<number>`count(*)` })
      .from(skillProgress)
      .where(inArray(skillProgress.skillId, ids))
      .get();
    progressRemoved += counted?.count ?? 0;
  }

  const change = (file: Set<string>, have: Set<string>, removed: number): Change => ({
    total: file.size,
    added: [...file].filter((key) => !have.has(key)).length,
    removed,
  });
  const summary: LoadSummary = {
    trees: change(fileTrees, haveTrees, gone.treeIds.length),
    categories: change(fileCategories, haveCategories, gone.categoryIds.length),
    skills: change(fileSkills, haveSkills, gone.skillIds.length),
    progressRemoved,
  };
  return { summary, gone };
}

/** What loading `set` would change, without changing anything. */
export async function previewTreeSet(db: Db, row: TreeSetRow, set: TreeSet): Promise<LoadSummary> {
  return (await plan(db, row, set)).summary;
}

/**
 * Makes the team's trees match `set`, all at once or not at all: rows are matched by key, updated
 * or added, and whatever the file doesn't have is deleted along with the progress on it.
 */
export async function applyTreeSet(
  db: Db,
  row: TreeSetRow,
  set: TreeSet,
  loadedByName: string | null,
): Promise<LoadSummary> {
  const { summary, gone } = await plan(db, row, set);
  const setId = row.id;
  const now = Date.now();

  // New rows have no ids until they're saved, so rows point at each other by key.
  const treeId = (key: string) =>
    sql<number>`(select id from trees where tree_set_id = ${setId} and key = ${key})`;
  const categoryId = (treeKey: string, key: string) =>
    sql<number>`(select c.id from tree_categories c join trees t on t.id = c.tree_id
                 where t.tree_set_id = ${setId} and t.key = ${treeKey} and c.key = ${key})`;
  const skillId = (key: string) =>
    sql<number>`(select id from skills where tree_set_id = ${setId} and key = ${key})`;

  const categories = set.trees.flatMap((tree) =>
    tree.categories.map((category, sortOrder) => ({ tree, category, sortOrder })),
  );
  const fileSkills = categories.flatMap(({ tree, category }) =>
    category.skills.map((skill, sortOrder) => ({ tree, category, skill, sortOrder })),
  );

  const statements: BatchItem<"sqlite">[] = [
    db
      .update(treeSets)
      .set({ name: set.name, loadedByName, loadedAt: now })
      .where(eq(treeSets.id, setId)),
  ];

  // Each statement stays under D1's 100 bound values.
  for (const chunk of chunks(set.trees, 8)) {
    statements.push(
      db
        .insert(trees)
        .values(
          chunk.map((tree) => ({
            treeSetId: setId,
            key: tree.key,
            name: tree.name,
            subtitle: tree.subtitle,
            icon: tree.icon,
            sortOrder: set.trees.indexOf(tree),
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [trees.treeSetId, trees.key],
          set: {
            name: sql`excluded.name`,
            subtitle: sql`excluded.subtitle`,
            icon: sql`excluded.icon`,
            sortOrder: sql`excluded.sort_order`,
            updatedAt: sql`excluded.updated_at`,
          },
        }),
    );
  }
  for (const tree of set.trees) {
    statements.push(
      db
        .update(trees)
        .set({ requiresTreeId: tree.requires ? treeId(tree.requires) : null })
        .where(and(eq(trees.treeSetId, setId), eq(trees.key, tree.key))),
    );
  }
  for (const chunk of chunks(categories, 12)) {
    statements.push(
      db
        .insert(treeCategories)
        .values(
          chunk.map(({ tree, category, sortOrder }) => ({
            treeId: treeId(tree.key),
            key: category.key,
            name: category.name,
            sortOrder,
          })),
        )
        .onConflictDoUpdate({
          target: [treeCategories.treeId, treeCategories.key],
          set: { name: sql`excluded.name`, sortOrder: sql`excluded.sort_order` },
        }),
    );
  }
  // A skill the file has moved to another category goes there, progress and all.
  for (const chunk of chunks(fileSkills, 9)) {
    statements.push(
      db
        .insert(skills)
        .values(
          chunk.map(({ tree, category, skill, sortOrder }) => ({
            treeSetId: setId,
            categoryId: categoryId(tree.key, category.key),
            key: skill.key,
            name: skill.name,
            summary: skill.summary,
            description: skill.description,
            sortOrder,
          })),
        )
        .onConflictDoUpdate({
          target: [skills.treeSetId, skills.key],
          set: {
            categoryId: sql`excluded.category_id`,
            name: sql`excluded.name`,
            summary: sql`excluded.summary`,
            description: sql`excluded.description`,
            sortOrder: sql`excluded.sort_order`,
          },
        }),
    );
  }

  // What comes after what is replaced whole.
  statements.push(
    db
      .delete(skillPrereqs)
      .where(
        inArray(
          skillPrereqs.skillId,
          db.select({ id: skills.id }).from(skills).where(eq(skills.treeSetId, setId)),
        ),
      ),
    db
      .delete(categoryPrereqs)
      .where(
        inArray(
          categoryPrereqs.categoryId,
          db
            .select({ id: treeCategories.id })
            .from(treeCategories)
            .innerJoin(trees, eq(trees.id, treeCategories.treeId))
            .where(eq(trees.treeSetId, setId)),
        ),
      ),
  );
  const skillLinks = fileSkills.flatMap(({ skill }) =>
    skill.requires.map((required) => ({
      skillId: skillId(skill.key),
      requiresSkillId: skillId(required),
    })),
  );
  for (const chunk of chunks(skillLinks, 20)) {
    statements.push(db.insert(skillPrereqs).values(chunk));
  }
  const categoryLinks = categories.flatMap(({ tree, category }) =>
    category.requires.map((required) => ({
      categoryId: categoryId(tree.key, category.key),
      requiresCategoryId: categoryId(tree.key, required),
    })),
  );
  for (const chunk of chunks(categoryLinks, 12)) {
    statements.push(db.insert(categoryPrereqs).values(chunk));
  }

  // Last, so skills that moved out of a deleted category or tree aren't deleted with it.
  for (const ids of chunks(gone.skillIds, 90)) {
    statements.push(db.delete(skills).where(inArray(skills.id, ids)));
  }
  for (const ids of chunks(gone.categoryIds, 90)) {
    statements.push(db.delete(treeCategories).where(inArray(treeCategories.id, ids)));
  }
  for (const ids of chunks(gone.treeIds, 90)) {
    statements.push(db.delete(trees).where(inArray(trees.id, ids)));
  }

  const [first, ...rest] = statements;
  await db.batch([first, ...rest]);
  return summary;
}
