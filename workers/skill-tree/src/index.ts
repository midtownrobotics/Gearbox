import { requireAuth, requireOAuthSession } from "@g3/auth";
import { corsOrigin } from "@g3/site-config";
import { eq, notInArray } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { validator } from "hono/validator";
import { createDb } from "./db";
import { skillMentors, skillProgress, skillSiteMentors } from "./db/schema";
import type { AppEnv } from "./types";

const VALID_STATUSES = ["not-started", "in-progress", "complete"] as const;
type SkillStatus = (typeof VALID_STATUSES)[number];

const base = new Hono<AppEnv>();

base.onError((err, c) => {
  console.error("[skill-tree]", err);
  const message = err instanceof Error ? err.message : String(err);
  return c.json({ error: "Internal server error.", detail: message }, 500);
});

base.use(
  "*",
  cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Is this user a mentor? Mentors are listed in skill_mentors; G3ID admins are
// always treated as mentors so there's a path to mentorship without extra UI.
async function isMentor(
  db: ReturnType<typeof createDb>,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true;
  const row = await db
    .select({ userId: skillMentors.userId })
    .from(skillMentors)
    .where(eq(skillMentors.userId, userId))
    .get();
  return !!row;
}

const skillUpdateValidator = validator(
  "json",
  (value, c): { skillId: string; status: SkillStatus } => {
    const v = (value ?? {}) as { skillId?: unknown; status?: unknown };
    if (typeof v.skillId !== "string" || !v.skillId.trim())
      return c.json({ error: "skillId must be a non-empty string." }, 400) as never;
    if (!VALID_STATUSES.includes(v.status as SkillStatus))
      return c.json(
        { error: "status must be not-started, in-progress, or complete." },
        400,
      ) as never;
    return { skillId: v.skillId, status: v.status as SkillStatus };
  },
);

const app = base
  .get("/health", (c) => c.json({ status: "ok", service: "skill-tree" }))

  // Current user — also self-registers their profile so they appear in the
  // student list, promotes G3ID admins to mentors, and mirrors the G3ID
  // sitewide mentor flag locally. Only G3ID site mentors skip self-registration
  // (they manage others but don't get their own tree); local skill-tree
  // mentors/admins still get one, same as always.
  .get("/me", requireAuth, async (c) => {
    const id = c.get("userId");
    const displayName = c.get("userDisplayName");
    const isAdmin = c.get("userIsAdmin");
    const isSiteMentor = c.get("userIsMentor");
    const db = createDb(c.env.SKILL_DB);

    if (isAdmin) {
      await db.insert(skillMentors).values({ userId: id }).onConflictDoNothing();
    }

    if (isSiteMentor) {
      // Site mentors get the same manage-others capability as local mentors/admins.
      await db.insert(skillMentors).values({ userId: id }).onConflictDoNothing();
      await db.insert(skillSiteMentors).values({ userId: id }).onConflictDoNothing();
      // Remove their personal skill tree — mentors only manage others
      await db.delete(skillProgress).where(eq(skillProgress.userId, id));
    } else {
      await db.delete(skillSiteMentors).where(eq(skillSiteMentors.userId, id));
      await db
        .insert(skillProgress)
        .values({ userId: id, displayName, progress: {}, updatedAt: Math.floor(Date.now() / 1000) })
        .onConflictDoUpdate({ target: skillProgress.userId, set: { displayName } });
    }

    const mentor = await isMentor(db, id, isAdmin);

    return c.json({ id, displayName, isAdmin, isMentor: mentor });
  })

  // All student profiles (the "students" collection) — excludes G3ID site
  // mentors specifically, who don't have a skill tree of their own. Local
  // skill-tree mentors/admins are unaffected and still appear.
  .get("/students", requireAuth, async (c) => {
    const db = createDb(c.env.SKILL_DB);
    const rows = await db
      .select({
        id: skillProgress.userId,
        displayName: skillProgress.displayName,
        progress: skillProgress.progress,
      })
      .from(skillProgress)
      .where(
        notInArray(
          skillProgress.userId,
          db.select({ userId: skillSiteMentors.userId }).from(skillSiteMentors),
        ),
      );
    return c.json(rows);
  })

  // List all mentors — for the mentor-management page. Any mentor (site admin,
  // site mentor, or existing skill-tree mentor/admin) can access this, not
  // just G3ID site admins.
  .get("/mentors", requireAuth, requireOAuthSession, async (c) => {
    const db = createDb(c.env.SKILL_DB);
    if (!(await isMentor(db, c.get("userId"), c.get("userIsAdmin")))) {
      return c.json({ error: "Forbidden." }, 403);
    }
    const rows = await db
      .select({ id: skillMentors.userId, displayName: skillProgress.displayName })
      .from(skillMentors)
      .leftJoin(skillProgress, eq(skillProgress.userId, skillMentors.userId));
    return c.json(rows.map((r) => ({ id: r.id, displayName: r.displayName ?? r.id })));
  })

  // Add a mentor — any mentor can grant mentorship to another user.
  .post("/mentors/:id", requireAuth, requireOAuthSession, async (c) => {
    const db = createDb(c.env.SKILL_DB);
    if (!(await isMentor(db, c.get("userId"), c.get("userIsAdmin")))) {
      return c.json({ error: "Forbidden." }, 403);
    }
    const targetId = c.req.param("id");
    await db.insert(skillMentors).values({ userId: targetId }).onConflictDoNothing();
    return c.json({ ok: true });
  })

  // Remove a mentor — any mentor can revoke another user's mentorship. Site
  // admins and site mentors are re-added on their next /me, so their
  // mentorship can't be permanently revoked here.
  .delete("/mentors/:id", requireAuth, requireOAuthSession, async (c) => {
    const db = createDb(c.env.SKILL_DB);
    if (!(await isMentor(db, c.get("userId"), c.get("userIsAdmin")))) {
      return c.json({ error: "Forbidden." }, 403);
    }
    const targetId = c.req.param("id");
    await db.delete(skillMentors).where(eq(skillMentors.userId, targetId));
    return c.json({ ok: true });
  })

  // Mentor membership check (the "mentors" collection doc lookup).
  .get("/mentors/:id", requireAuth, async (c) => {
    const targetId = c.req.param("id");
    const db = createDb(c.env.SKILL_DB);
    // A user counts as a mentor if listed, or if they are a G3ID admin (but we
    // can only know admin status for the caller, so listed-membership is the
    // source of truth here; admins are inserted into the table on their /me).
    const row = await db
      .select({ userId: skillMentors.userId })
      .from(skillMentors)
      .where(eq(skillMentors.userId, targetId))
      .get();
    return c.json({ exists: !!row });
  })

  // Update a single skill for a student — mentors only.
  .patch("/students/:id", requireAuth, requireOAuthSession, skillUpdateValidator, async (c) => {
    const targetId = c.req.param("id");
    const { skillId, status } = c.req.valid("json");
    const callerId = c.get("userId");
    const isAdmin = c.get("userIsAdmin");
    const db = createDb(c.env.SKILL_DB);

    if (!(await isMentor(db, callerId, isAdmin))) {
      return c.json({ error: "Only mentors can update progress." }, 403);
    }

    const now = Math.floor(Date.now() / 1000);
    const existing = await db
      .select()
      .from(skillProgress)
      .where(eq(skillProgress.userId, targetId))
      .get();

    const progress = { ...(existing?.progress ?? {}), [skillId]: status };

    if (existing) {
      await db
        .update(skillProgress)
        .set({ progress, updatedAt: now })
        .where(eq(skillProgress.userId, targetId));
    } else {
      // Target hasn't logged in yet — create a placeholder keyed by id.
      await db
        .insert(skillProgress)
        .values({ userId: targetId, displayName: targetId, progress, updatedAt: now });
    }

    return c.json({ ok: true });
  });

export type SkillTreeApp = typeof app;
export default app;
