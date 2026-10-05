import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// All of this is one team's data, and everything hangs off the team's tree set: keys are unique
// inside a set, a tree or a category, never across a whole table, so a team column on tree_sets
// is all a second team needs here (roadmap Phase 3).

/**
 * The trees a team uses, as one set that can be saved to a file and loaded from one
 * (src/lib/tree-set.ts). A single row until tables carry a team; then one per team.
 */
export const treeSets = sqliteTable("tree_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** Who last loaded the set from a file. Null when the app loaded the default set itself. */
  loadedByName: text("loaded_by_name"),
  loadedAt: integer("loaded_at").notNull(),
});

// `key` on trees, categories and skills is the name a file knows them by. Loading a file again
// matches rows by key, so a skill that's still in the file keeps everyone's progress on it.

/** A discipline's skills ("Manufacturing"). */
export const trees = sqliteTable(
  "trees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    treeSetId: integer("tree_set_id")
      .notNull()
      .references(() => treeSets.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    subtitle: text("subtitle").notNull().default(""),
    /** An emoji shown beside the name. */
    icon: text("icon").notNull().default(""),
    /** The tree a student must finish before this one opens (Safety, in the default set). */
    requiresTreeId: integer("requires_tree_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("trees_key_idx").on(t.treeSetId, t.key)],
);

/** A tree's groups of skills ("Shop Safety"). A category opens when the ones it requires are done. */
export const treeCategories = sqliteTable(
  "tree_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    treeId: integer("tree_id")
      .notNull()
      .references(() => trees.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("tree_categories_key_idx").on(t.treeId, t.key)],
);

export const categoryPrereqs = sqliteTable(
  "category_prereqs",
  {
    categoryId: integer("category_id")
      .notNull()
      .references(() => treeCategories.id, { onDelete: "cascade" }),
    requiresCategoryId: integer("requires_category_id")
      .notNull()
      .references(() => treeCategories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.requiresCategoryId] })],
);

export const skills = sqliteTable(
  "skills",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /**
     * The category's tree's set, repeated here so a skill's key can be unique in the whole set: a
     * skill moved to another category in a file is still the same skill.
     */
    treeSetId: integer("tree_set_id")
      .notNull()
      .references(() => treeSets.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => treeCategories.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** A few words under the name on the skill's box. */
    summary: text("summary").notNull().default(""),
    /** What a student must show to have the skill signed off. */
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    uniqueIndex("skills_key_idx").on(t.treeSetId, t.key),
    index("skills_category_idx").on(t.categoryId),
  ],
);

/** Skills in the same category that must be complete first. */
export const skillPrereqs = sqliteTable(
  "skill_prereqs",
  {
    skillId: integer("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    requiresSkillId: integer("requires_skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.skillId, t.requiresSkillId] })],
);

/** The statuses a mentor sets. A skill with no row is "not-started". */
export const PROGRESS_STATUSES = ["in-progress", "complete"] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

/** A student's progress on a skill, by G3ID user id. */
export const skillProgress = sqliteTable(
  "skill_progress",
  {
    userId: text("user_id").notNull(),
    skillId: integer("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    status: text("status", { enum: PROGRESS_STATUSES }).notNull(),
    /** The mentor who set it. */
    updatedById: text("updated_by_id").notNull(),
    updatedByName: text("updated_by_name").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.skillId] }),
    index("skill_progress_skill_idx").on(t.skillId),
  ],
);

/**
 * G3ID accounts known to be mentors, which are left out of the list of students. G3ID's list of
 * accounts doesn't say who is a mentor, so this is what Skill Tree has learned from sign-ins
 * (src/lib/roster.ts).
 */
export const mentors = sqliteTable(
  "mentors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
  },
  (t) => [uniqueIndex("mentors_user_idx").on(t.userId)],
);
