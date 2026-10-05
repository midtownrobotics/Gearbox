import type { CategoryView, SkillView, TreeView } from "@g3/worker-skill-tree";

// What a student's saved progress means for each tree, category and skill: what is open to work
// on, and what is still locked behind something else.

export type Tree = TreeView;
export type Category = CategoryView;
export type Skill = SkillView;

/** What a mentor sets on a skill. */
export type Status = "not-started" | "in-progress" | "complete";

/** A student's started and finished skills, by skill id. Skills not listed aren't started. */
export type Progress = Record<string, "in-progress" | "complete">;

export type Student = { userId: string; name: string; progress: Progress };

/** The team's set of trees: its name, and who last loaded it from a file. */
export type TreeSetInfo = { name: string; loadedByName: string | null; loadedAt: number };

/** How a skill or category shows for a student. */
export type NodeState = "locked" | "available" | "in-progress" | "complete";

export const STATUS_LABEL: Record<Status, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  complete: "Complete",
};

export const statusOf = (progress: Progress, skillId: number): Status =>
  progress[skillId] ?? "not-started";

export const treeSkills = (tree: Tree): Skill[] => tree.categories.flatMap((c) => c.skills);

export function countSkills(list: Skill[], progress: Progress) {
  let complete = 0;
  let inProgress = 0;
  for (const skill of list) {
    const status = statusOf(progress, skill.id);
    if (status === "complete") complete++;
    else if (status === "in-progress") inProgress++;
  }
  return { total: list.length, complete, inProgress };
}

export const percent = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

const allComplete = (list: Skill[], progress: Progress) =>
  list.every((skill) => statusOf(progress, skill.id) === "complete");

/** The tree that must be finished before `tree` opens, if the student hasn't finished it. */
export function lockedBehind(tree: Tree, trees: Tree[], progress: Progress): Tree | null {
  const required = trees.find((t) => t.id === tree.requiresTreeId);
  return required && !allComplete(treeSkills(required), progress) ? required : null;
}

function categoryUnlocked(tree: Tree, category: Category, trees: Tree[], progress: Progress) {
  if (lockedBehind(tree, trees, progress)) return false;
  return category.requires.every((id) => {
    const required = tree.categories.find((c) => c.id === id);
    return !required || allComplete(required.skills, progress);
  });
}

export function categoryState(
  tree: Tree,
  category: Category,
  trees: Tree[],
  progress: Progress,
): NodeState {
  if (!categoryUnlocked(tree, category, trees, progress)) return "locked";
  if (allComplete(category.skills, progress)) return "complete";
  const started = category.skills.some((skill) => statusOf(progress, skill.id) !== "not-started");
  return started ? "in-progress" : "available";
}

export function skillState(
  tree: Tree,
  category: Category,
  skill: Skill,
  trees: Tree[],
  progress: Progress,
): NodeState {
  const open =
    categoryUnlocked(tree, category, trees, progress) &&
    skill.requires.every((id) => statusOf(progress, id) === "complete");
  if (!open) return "locked";
  const status = statusOf(progress, skill.id);
  return status === "not-started" ? "available" : status;
}
