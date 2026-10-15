import { DEMO_PEOPLE, DEMO_STUDENTS, type DemoPerson, vocabularyOf } from "@g3/demo";
import { asc, eq } from "drizzle-orm";
import type { createDb } from "./db";
import { skillProgress, skills } from "./db/schema";
import { currentTreeSet, defaultTreeSet } from "./lib/tree-set";

// The public demo's Skill Tree (roadmap 5.3), loaded after its nightly reset: the default trees,
// and each student partway through them, some further along than others.

type Db = ReturnType<typeof createDb>;
const DAY = 24 * 60 * 60 * 1000;

export async function loadDemo(db: Db, teamId: string) {
  const set = await currentTreeSet(db, teamId);
  const all = await db
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.treeSetId, set.id))
    .orderBy(asc(skills.id))
    .all();
  const mentor = DEMO_PEOPLE[1] as DemoPerson;
  const now = Date.now();
  const marks = DEMO_STUDENTS.flatMap((student, i) => {
    // Earlier students are further along: from about half the skills down to a few.
    const done = Math.max(2, Math.floor(all.length * (0.5 - i * 0.04)));
    return all.slice(0, done + 2).map((skill, n) => ({
      userId: student.id,
      skillId: skill.id,
      status: n < done ? ("complete" as const) : ("in-progress" as const),
      updatedById: mentor.id,
      updatedByName: mentor.name,
      updatedAt: now - ((n * 3 + i) % 40) * DAY,
    }));
  });
  // Ten rows a statement: D1 takes at most 100 values in one.
  for (let i = 0; i < marks.length; i += 10) {
    await db.insert(skillProgress).values(marks.slice(i, i + 10));
  }
  return { skills: all.length, marks: marks.length };
}

/** The words in the demo's trees, for the gateway (everything else is from @g3/demo's lists). */
export const demoWords = (): string[] => vocabularyOf(defaultTreeSet());
