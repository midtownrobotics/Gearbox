import { requireAuth, requireMentor } from "@g3/auth";
import { and, eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { type Db, createDb } from "../db";
import { type ProgressStatus, skillProgress, skills } from "../db/schema";
import { chunks, idList, parseId } from "../lib/input";
import { ROSTER_UNAVAILABLE, loadStudents } from "../lib/roster";
import { currentTreeSet } from "../lib/tree-set";
import type { AppEnv } from "../types";

// Who has done what. The students are G3ID's accounts that aren't mentors (lib/roster.ts);
// Skill Tree only stores their progress. Anyone signed in sees the team's progress; only mentors
// (and admins) set it, never from a kiosk PIN session (G3ID reports no roles for those).

/** What a mentor can set a skill to. "not-started" clears it. */
const STATUSES = ["not-started", "in-progress", "complete"] as const;
type Status = (typeof STATUSES)[number];

const isStatus = (value: unknown): value is Status => STATUSES.includes(value as Status);

/** The most person × skill marks one bulk sign-off may make. */
const MAX_MARKS = 2000;

const statusValidator = validator("json", (value, c): { status: Status } => {
  const status = (value as { status?: unknown })?.status;
  if (!isStatus(status)) {
    return c.json({ error: "status must be not-started, in-progress or complete." }, 400) as never;
  }
  return { status };
});

const bulkValidator = validator(
  "json",
  (value, c): { userIds: string[]; skillIds: number[]; status: Status } => {
    const v = (value ?? {}) as Record<string, unknown>;
    const fail = (error: string) => c.json({ error }, 400) as never;
    const userIds = v.userIds;
    if (
      !Array.isArray(userIds) ||
      userIds.length === 0 ||
      userIds.length > 100 ||
      !userIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 100)
    ) {
      return fail("userIds must be 1–100 people.");
    }
    const skillIds = idList(v.skillIds, 100);
    if (!skillIds || skillIds.length === 0) return fail("skillIds must be 1–100 skills.");
    if (!isStatus(v.status)) {
      return fail("status must be not-started, in-progress or complete.");
    }
    const people = [...new Set(userIds as string[])];
    if (people.length * skillIds.length > MAX_MARKS) {
      return fail(`That's more than ${MAX_MARKS} marks at once. Split it into smaller groups.`);
    }
    return { userIds: people, skillIds, status: v.status };
  },
);

/** Sets `status` on every skill for every student, signed by the current user. */
async function setProgress(
  c: Context<AppEnv>,
  db: Db,
  userIds: string[],
  skillIds: number[],
  status: Status,
) {
  const statements: BatchItem<"sqlite">[] = [];
  if (status === "not-started") {
    for (const userId of userIds) {
      for (const chunk of chunks(skillIds, 90)) {
        statements.push(
          db
            .delete(skillProgress)
            .where(and(eq(skillProgress.userId, userId), inArray(skillProgress.skillId, chunk))),
        );
      }
    }
  } else {
    const signed = {
      status,
      updatedById: c.get("userId"),
      updatedByName: c.get("userDisplayName"),
      updatedAt: Date.now(),
    };
    const rows = userIds.flatMap((userId) =>
      skillIds.map((skillId) => ({ userId, skillId, ...signed })),
    );
    // Six values per row, and four more for the update.
    for (const chunk of chunks(rows, 15)) {
      statements.push(
        db
          .insert(skillProgress)
          .values(chunk)
          .onConflictDoUpdate({
            target: [skillProgress.userId, skillProgress.skillId],
            set: signed,
          }),
      );
    }
  }
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}

/** Which of `skillIds` are in the team's tree set. */
async function skillsInSet(db: Db, skillIds: number[]) {
  const set = await currentTreeSet(db);
  const found = await db
    .select({ id: skills.id })
    .from(skills)
    .where(and(eq(skills.treeSetId, set.id), inArray(skills.id, skillIds)))
    .all();
  return found.map((row) => row.id);
}

export const studentsRouter = new Hono<AppEnv>()
  /** Every student and the status of each skill they've started. */
  .get("/", requireAuth, async (c) => {
    const db = createDb(c.env.SKILL_DB);
    const [students, progress] = await Promise.all([
      loadStudents(c, db),
      db
        .select({
          userId: skillProgress.userId,
          skillId: skillProgress.skillId,
          status: skillProgress.status,
        })
        .from(skillProgress)
        .all(),
    ]);
    if (!students) return c.json({ error: ROSTER_UNAVAILABLE }, 502);
    const byUser = new Map<string, Record<string, ProgressStatus>>();
    for (const row of progress) {
      const map = byUser.get(row.userId) ?? {};
      map[row.skillId] = row.status;
      byUser.set(row.userId, map);
    }
    return c.json({
      students: students.map((student) => ({
        ...student,
        /** By skill id. Skills not listed aren't started. */
        progress: byUser.get(student.userId) ?? {},
      })),
    });
  })
  /** Who has this kiosk PIN, so students can add themselves to a mentor's bulk sign-off. */
  .get("/by-pin/:pin", requireMentor, async (c) => {
    const pin = c.req.param("pin");
    if (!/^\d{1,8}$/.test(pin)) return c.json({ error: "A PIN is digits only." }, 400);
    const res = await c.env.G3ID.fetch(
      new Request(`http://g3id/api/users/by-pin/${pin}`, {
        headers: { cookie: c.req.header("Cookie") ?? "" },
      }),
    );
    if (!res.ok) return c.json({ error: "No one has that PIN." }, 404);
    const { id } = (await res.json()) as { id: string };
    const students = await loadStudents(c, createDb(c.env.SKILL_DB));
    if (!students) return c.json({ error: ROSTER_UNAVAILABLE }, 502);
    const student = students.find((s) => s.userId === id);
    if (!student) return c.json({ error: "That PIN isn't a student's." }, 404);
    return c.json(student);
  })
  /** One student's progress, with who signed each skill off and when. */
  .get("/:userId", requireAuth, async (c) => {
    const db = createDb(c.env.SKILL_DB);
    const students = await loadStudents(c, db);
    if (!students) return c.json({ error: ROSTER_UNAVAILABLE }, 502);
    const student = students.find((s) => s.userId === c.req.param("userId"));
    if (!student) return c.json({ error: "No student by that id." }, 404);
    const progress = await db
      .select({
        skillId: skillProgress.skillId,
        status: skillProgress.status,
        updatedByName: skillProgress.updatedByName,
        updatedAt: skillProgress.updatedAt,
      })
      .from(skillProgress)
      .where(eq(skillProgress.userId, student.userId))
      .all();
    return c.json({ ...student, progress });
  })
  .put("/:userId/skills/:skillId", requireMentor, statusValidator, async (c) => {
    const skillId = parseId(c.req.param("skillId"));
    const userId = c.req.param("userId");
    const { status } = c.req.valid("json");
    const db = createDb(c.env.SKILL_DB);
    if (skillId === null || (await skillsInSet(db, [skillId])).length === 0) {
      return c.json({ error: "Skill not found." }, 404);
    }
    const students = await loadStudents(c, db);
    if (!students) return c.json({ error: ROSTER_UNAVAILABLE }, 502);
    if (!students.some((s) => s.userId === userId)) {
      return c.json({ error: "No student by that id." }, 404);
    }
    await setProgress(c, db, [userId], [skillId], status);
    return c.json({ ok: true });
  });

/** Bulk sign-off: one status for several students on several skills. */
export const progressRouter = new Hono<AppEnv>().post(
  "/",
  requireMentor,
  bulkValidator,
  async (c) => {
    const { userIds, skillIds, status } = c.req.valid("json");
    const db = createDb(c.env.SKILL_DB);
    if ((await skillsInSet(db, skillIds)).length !== skillIds.length) {
      return c.json({ error: "One of those skills no longer exists. Reload and try again." }, 400);
    }
    const students = await loadStudents(c, db);
    if (!students) return c.json({ error: ROSTER_UNAVAILABLE }, 502);
    const known = new Set(students.map((s) => s.userId));
    if (!userIds.every((userId) => known.has(userId))) {
      return c.json({ error: "One of those people isn't a student. Reload and try again." }, 404);
    }
    await setProgress(c, db, userIds, skillIds, status);
    return c.json({ updated: userIds.length * skillIds.length });
  },
);
