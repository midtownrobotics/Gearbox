import { inTeam, requireAuth, withTeam } from "@g3/auth";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createShopDb } from "../db";
import { actions, partInstanceProcesses } from "../db/schema";
import { finished, promoteNextSteps } from "../lib/steps";
import type { AppEnv } from "../types";
import { recordAction } from "./actions";

const updateProcessStatusValidator = validator("json", (value, c): { status: string } => {
  const v = (value ?? {}) as { status?: unknown };
  if (!v.status || !["todo", "doing", "done"].includes(v.status as string)) {
    return c.json({ error: "status must be 'todo', 'doing', or 'done'" }, 400) as never;
  }
  return { status: v.status as string };
});

// D1 caps a statement at 100 bound parameters; the widest write here (actions) has 6 columns.
const BULK_CHUNK = 15;

const bulkValidator = validator(
  "json",
  (value, c): { processId: number; partInstanceIds: number[]; to: "doing" | "done" } => {
    const v = (value ?? {}) as { processId?: unknown; partInstanceIds?: unknown; to?: unknown };
    const ids = v.partInstanceIds;
    if (!Number.isInteger(v.processId) || (v.processId as number) < 1) {
      return c.json({ error: "processId must be a positive integer." }, 400) as never;
    }
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > 500 ||
      !ids.every((n) => Number.isInteger(n) && n > 0)
    ) {
      return c.json({ error: "partInstanceIds must be 1–500 positive integers." }, 400) as never;
    }
    if (v.to !== "doing" && v.to !== "done") {
      return c.json({ error: "to must be 'doing' or 'done'." }, 400) as never;
    }
    return {
      processId: v.processId as number,
      partInstanceIds: [...new Set(ids as number[])],
      to: v.to,
    };
  },
);

export const partInstanceProcessesRouter = new Hono<AppEnv>()
  /**
   * Moves many instances' step at one process in a few set-based statements: To Do → In
   * Progress ("doing"), or In Progress → done, which also unlocks each instance's next step.
   * Instances not in the expected starting status are skipped. Returns how many moved.
   */
  .post("/bulk", requireAuth, bulkValidator, async (c) => {
    const { processId, partInstanceIds, to } = c.req.valid("json");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const now = Date.now();
    const from = to === "doing" ? "todo" : "doing";
    const moved: number[] = [];

    for (let i = 0; i < partInstanceIds.length; i += BULK_CHUNK) {
      const ids = partInstanceIds.slice(i, i + BULK_CHUNK);
      const rows = await db
        .update(partInstanceProcesses)
        .set(to === "done" ? { status: "done", completedAt: now } : { status: "doing" })
        .where(
          inTeam(
            partInstanceProcesses,
            teamId,
            eq(partInstanceProcesses.processId, processId),
            eq(partInstanceProcesses.status, from),
            inArray(partInstanceProcesses.partInstanceId, ids),
          ),
        )
        .returning({ id: partInstanceProcesses.partInstanceId })
        .all();
      moved.push(...rows.map((r) => r.id));

      if (to === "done" && rows.length > 0) {
        // Promote each completed instance's next step, mirroring the single-instance route.
        await promoteNextSteps(
          db,
          teamId,
          and(
            eq(finished.processId, processId),
            eq(finished.completedAt, now),
            inArray(
              finished.partInstanceId,
              rows.map((r) => r.id),
            ),
          ),
        );
      }
    }

    // Same policy as recordAction: the audit log never blocks shop-floor work.
    try {
      const userId = c.get("userId");
      const action: "started" | "completed" = to === "doing" ? "started" : "completed";
      for (let i = 0; i < moved.length; i += BULK_CHUNK) {
        await db.insert(actions).values(
          withTeam(
            teamId,
            moved.slice(i, i + BULK_CHUNK).map((partInstanceId) => ({
              userId,
              partInstanceId,
              processId,
              action,
              createdAt: now,
            })),
          ),
        );
      }
    } catch (err) {
      console.error("Failed to record actions:", err);
    }

    return c.json({ moved: moved.length, requested: partInstanceIds.length });
  })
  .get("/", requireAuth, async (c) => {
    const processId = c.req.query("processId");
    const partInstanceId = c.req.query("partInstanceId");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");

    if (processId) {
      const rows = await db
        .select()
        .from(partInstanceProcesses)
        .where(
          inTeam(
            partInstanceProcesses,
            teamId,
            eq(partInstanceProcesses.processId, Number(processId)),
          ),
        )
        .all();
      return c.json(rows);
    }

    if (partInstanceId) {
      const rows = await db
        .select()
        .from(partInstanceProcesses)
        .where(
          inTeam(
            partInstanceProcesses,
            teamId,
            eq(partInstanceProcesses.partInstanceId, Number(partInstanceId)),
          ),
        )
        .all();
      return c.json(rows);
    }

    return c.json({ error: "processId or partInstanceId query param is required." }, 400);
  })
  .post("/:partInstanceId/processes/:processId/done", requireAuth, async (c) => {
    const partInstanceId = Number(c.req.param("partInstanceId"));
    const processId = Number(c.req.param("processId"));

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const row = await db
      .update(partInstanceProcesses)
      .set({ status: "done", completedAt: Date.now() })
      .where(
        inTeam(
          partInstanceProcesses,
          teamId,
          eq(partInstanceProcesses.partInstanceId, partInstanceId),
          eq(partInstanceProcesses.processId, processId),
        ),
      )
      .returning()
      .get();

    if (!row) return c.json({ error: "Part instance process not found." }, 404);

    // Promote the next process in the pipeline so it becomes actionable.
    const next = await db
      .select()
      .from(partInstanceProcesses)
      .where(
        inTeam(
          partInstanceProcesses,
          teamId,
          eq(partInstanceProcesses.partInstanceId, partInstanceId),
          gt(partInstanceProcesses.index, row.index),
        ),
      )
      .orderBy(asc(partInstanceProcesses.index))
      .limit(1)
      .get();

    if (next && next.status === "waiting") {
      await db
        .update(partInstanceProcesses)
        .set({ status: "todo" })
        .where(inTeam(partInstanceProcesses, teamId, eq(partInstanceProcesses.id, next.id)));
    }

    await recordAction(db, teamId, {
      userId: c.get("userId"),
      partInstanceId,
      processId,
      action: "completed",
    });

    return c.json(row);
  })
  .post("/:partInstanceId/processes/:processId/doing", requireAuth, async (c) => {
    const partInstanceId = Number(c.req.param("partInstanceId"));
    const processId = Number(c.req.param("processId"));

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const row = await db
      .update(partInstanceProcesses)
      .set({ status: "doing" })
      .where(
        inTeam(
          partInstanceProcesses,
          teamId,
          eq(partInstanceProcesses.partInstanceId, partInstanceId),
          eq(partInstanceProcesses.processId, processId),
        ),
      )
      .returning()
      .get();

    if (!row) return c.json({ error: "Part instance process not found." }, 404);

    await recordAction(db, teamId, {
      userId: c.get("userId"),
      partInstanceId,
      processId,
      action: "started",
    });

    return c.json(row);
  })
  .patch(
    "/:partInstanceId/processes/:processId",
    requireAuth,
    updateProcessStatusValidator,
    async (c) => {
      const { status } = c.req.valid("json");
      const partInstanceId = Number(c.req.param("partInstanceId"));
      const processId = Number(c.req.param("processId"));

      const db = createShopDb(c.env.SHOP_DB);
      const teamId = c.get("teamId");
      const row = await db
        .update(partInstanceProcesses)
        .set({
          status: status as "todo" | "doing" | "done",
          completedAt: status === "done" ? Date.now() : null,
        })
        .where(
          inTeam(
            partInstanceProcesses,
            teamId,
            eq(partInstanceProcesses.partInstanceId, partInstanceId),
            eq(partInstanceProcesses.processId, processId),
          ),
        )
        .returning()
        .get();

      if (!row) return c.json({ error: "Part instance process not found." }, 404);

      // When reverting from "done" to an earlier state, reset the next process back to "waiting"
      if (status !== "done") {
        const next = await db
          .select()
          .from(partInstanceProcesses)
          .where(
            inTeam(
              partInstanceProcesses,
              teamId,
              eq(partInstanceProcesses.partInstanceId, partInstanceId),
              gt(partInstanceProcesses.index, row.index),
            ),
          )
          .orderBy(asc(partInstanceProcesses.index))
          .limit(1)
          .get();

        if (next && next.status === "todo") {
          await db
            .update(partInstanceProcesses)
            .set({ status: "waiting" })
            .where(inTeam(partInstanceProcesses, teamId, eq(partInstanceProcesses.id, next.id)));
        }
      }

      // Record action for "done" status; other transitions are considered manual adjustments
      if (status === "done") {
        await recordAction(db, teamId, {
          userId: c.get("userId"),
          partInstanceId,
          processId,
          action: "completed",
        });
      }

      return c.json(row);
    },
  );
