import { inTeam, requireAdmin, requireAuth, withTeam } from "@g3/auth";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { validator } from "hono/validator";
import { createShopDb } from "../db";
import {
  type QualitySuspect,
  actions,
  partDefinitions,
  partInstanceProcesses,
  partInstances,
  processes,
  qualityReports,
} from "../db/schema";
import { canQualityCheck, qualityReportsOn } from "../lib/quality";
import { finished, promoteNextSteps } from "../lib/steps";
import type { AppEnv } from "../types";
import { recordAction } from "./actions";

// Quality reports: with the team's quality reports on, a part at a Quality Control step is checked
// with a report instead of Mark Complete. Four checks (each ticked even when it doesn't apply to
// the part); when one fails, the steps it likely came from (or Unsure) and notes. A passing report
// finishes the step; a failing one leaves the part there until it's sent back. Only shop managers
// and admins write reports, and admins read them on the Admin page.

type ShopDb = ReturnType<typeof createShopDb>;

export const QUALITY_CHECKS = ["dimensions", "thickness", "positions", "sizes"] as const;
type Checks = Record<(typeof QUALITY_CHECKS)[number], boolean>;

type ReportInput = {
  partInstanceId: number;
  processId: number;
  checks: Checks;
  suspectProcessIds: number[];
  unsure: boolean;
  notes: string | null;
};

const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

const reportValidator = validator("json", (value, c): ReportInput => {
  const v = (value ?? {}) as Record<string, unknown>;
  const bad = (error: string) => c.json({ error }, 400) as never;
  if (!isId(v.partInstanceId)) return bad("partInstanceId must be a positive integer.");
  if (!isId(v.processId)) return bad("processId must be a positive integer.");
  const checks = (v.checks ?? {}) as Record<string, unknown>;
  if (QUALITY_CHECKS.some((k) => typeof checks[k] !== "boolean")) {
    return bad(`checks must say true or false for ${QUALITY_CHECKS.join(", ")}.`);
  }
  const suspects = v.suspectProcessIds ?? [];
  if (!Array.isArray(suspects) || suspects.length > 25 || !suspects.every(isId)) {
    return bad("suspectProcessIds must be up to 25 process ids.");
  }
  if (v.unsure !== undefined && typeof v.unsure !== "boolean") {
    return bad("unsure must be true or false.");
  }
  if (v.notes !== undefined && v.notes !== null && typeof v.notes !== "string") {
    return bad("notes must be text.");
  }
  const notes = typeof v.notes === "string" ? v.notes.trim() : "";
  if (notes.length > 2000) return bad("Notes can be 2,000 characters at most.");
  return {
    partInstanceId: v.partInstanceId,
    processId: v.processId,
    checks: Object.fromEntries(QUALITY_CHECKS.map((k) => [k, checks[k] === true])) as Checks,
    suspectProcessIds: [...new Set(suspects as number[])],
    unsure: v.unsure === true,
    notes: notes || null,
  };
});

const sendBackValidator = validator(
  "json",
  (value, c): { processId: number; status: "todo" | "doing" } => {
    const v = (value ?? {}) as { processId?: unknown; status?: unknown };
    if (!isId(v.processId)) {
      return c.json({ error: "processId must be a positive integer." }, 400) as never;
    }
    if (v.status !== "todo" && v.status !== "doing") {
      return c.json({ error: "status must be 'todo' or 'doing'." }, 400) as never;
    }
    return { processId: v.processId, status: v.status };
  },
);

/** Who's asking, for the shop manager check. */
const user = (c: Context<AppEnv>) => ({ id: c.get("userId"), isAdmin: c.get("userIsAdmin") });

const NOT_A_MANAGER = "Only a shop manager can do a quality report.";

/** An instance's steps in order. */
function stepsOf(db: ShopDb, teamId: string, partInstanceId: number) {
  return db
    .select()
    .from(partInstanceProcesses)
    .where(
      inTeam(
        partInstanceProcesses,
        teamId,
        eq(partInstanceProcesses.partInstanceId, partInstanceId),
      ),
    )
    .orderBy(asc(partInstanceProcesses.index))
    .all();
}

/**
 * Each step before `beforeIndex`, with when it was last finished and by whom (the latest
 * "completed" in the actions log for that step's process).
 */
async function historyBefore(
  db: ShopDb,
  teamId: string,
  partInstanceId: number,
  steps: (typeof partInstanceProcesses.$inferSelect)[],
  beforeIndex: number,
): Promise<QualitySuspect[]> {
  const earlier = steps.filter((s) => s.index < beforeIndex);
  if (earlier.length === 0) return [];
  const [names, done] = await Promise.all([
    db
      .select({ id: processes.id, name: processes.name })
      .from(processes)
      .where(
        inTeam(
          processes,
          teamId,
          inArray(processes.id, [...new Set(earlier.map((s) => s.processId))]),
        ),
      )
      .all(),
    db
      .select({ processId: actions.processId, userId: actions.userId })
      .from(actions)
      .where(
        inTeam(
          actions,
          teamId,
          eq(actions.partInstanceId, partInstanceId),
          eq(actions.action, "completed"),
        ),
      )
      .orderBy(desc(actions.createdAt))
      .all(),
  ]);
  const nameOf = new Map(names.map((p) => [p.id, p.name]));
  return earlier.map((s) => ({
    processId: s.processId,
    name: nameOf.get(s.processId) ?? `Process #${s.processId}`,
    completedAt: s.completedAt,
    completedBy: done.find((a) => a.processId === s.processId)?.userId ?? null,
  }));
}

export const qualityReportsRouter = new Hono<AppEnv>()
  /** Every report the team has, newest first (the Admin page's table). */
  .get("/", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const rows = await db
      .select()
      .from(qualityReports)
      .where(inTeam(qualityReports, c.get("teamId")))
      .orderBy(desc(qualityReports.createdAt))
      .all();
    return c.json(rows);
  })
  /**
   * A report on a part waiting at a Quality Control step. Passing finishes the step; failing
   * keeps it there, with who finished each suspect step and when. Answers the report and the
   * history of every step before it (for a reporter who was unsure where it went wrong).
   */
  .post("/", requireAuth, reportValidator, async (c) => {
    const body = c.req.valid("json");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");

    if (!(await qualityReportsOn(db, teamId))) {
      return c.json({ error: "Quality reports are off for this team." }, 409);
    }
    if (!(await canQualityCheck(db, teamId, user(c)))) return c.json({ error: NOT_A_MANAGER }, 403);

    const [process, instance] = await Promise.all([
      db
        .select({ id: processes.id, name: processes.name, type: processes.type })
        .from(processes)
        .where(inTeam(processes, teamId, eq(processes.id, body.processId)))
        .get(),
      db
        .select()
        .from(partInstances)
        .where(inTeam(partInstances, teamId, eq(partInstances.id, body.partInstanceId)))
        .get(),
    ]);
    if (!process || !instance) return c.json({ error: "Part or process not found." }, 404);
    if (process.type !== "quality_control") {
      return c.json({ error: `${process.name} isn't a Quality Control process.` }, 400);
    }
    const definition = await db
      .select()
      .from(partDefinitions)
      .where(inTeam(partDefinitions, teamId, eq(partDefinitions.id, instance.partDefinitionId)))
      .get();
    if (!definition) return c.json({ error: "Part not found." }, 404);

    const steps = await stepsOf(db, teamId, instance.id);
    const step = steps.find(
      (s) => s.processId === process.id && (s.status === "todo" || s.status === "doing"),
    );
    if (!step) {
      return c.json({ error: `This part isn't waiting at ${process.name} right now.` }, 409);
    }

    const passed = Object.values(body.checks).every(Boolean);
    const earlierIds = new Set(steps.filter((s) => s.index < step.index).map((s) => s.processId));
    if (!passed) {
      if (body.suspectProcessIds.length === 0 && !body.unsure) {
        return c.json({ error: "Pick the step it likely went wrong at, or Unsure." }, 400);
      }
      if (body.suspectProcessIds.some((id) => !earlierIds.has(id))) {
        return c.json({ error: "A likely step has to be one this part went through." }, 400);
      }
    }

    const now = Date.now();
    if (passed) {
      // Finish the step first, so a report never says passed for a step someone else moved.
      const done = await db
        .update(partInstanceProcesses)
        .set({ status: "done", completedAt: now })
        .where(
          inTeam(
            partInstanceProcesses,
            teamId,
            eq(partInstanceProcesses.id, step.id),
            inArray(partInstanceProcesses.status, ["todo", "doing"]),
          ),
        )
        .returning({ id: partInstanceProcesses.id })
        .get();
      if (!done) {
        return c.json({ error: `This part isn't waiting at ${process.name} right now.` }, 409);
      }
      await promoteNextSteps(db, teamId, eq(finished.id, step.id));
    }

    const history = await historyBefore(db, teamId, instance.id, steps, step.index);
    // A process twice in the pipeline is named once, at its latest run.
    const latest = new Map(history.map((h) => [h.processId, h]));
    const suspects = passed ? [] : body.suspectProcessIds.flatMap((id) => latest.get(id) ?? []);

    const report = await db
      .insert(qualityReports)
      .values(
        withTeam(teamId, {
          partInstanceId: instance.id,
          partDefinitionId: definition.id,
          partName: definition.name ?? definition.onshapePartNumber,
          partNumber: definition.onshapePartNumber,
          revision: definition.revision,
          instanceNumber: instance.instanceNumber,
          processId: process.id,
          processName: process.name,
          reportedBy: c.get("userId"),
          createdAt: now,
          dimensionsOk: body.checks.dimensions ? 1 : 0,
          thicknessOk: body.checks.thickness ? 1 : 0,
          positionsOk: body.checks.positions ? 1 : 0,
          sizesOk: body.checks.sizes ? 1 : 0,
          passed: passed ? 1 : 0,
          unsure: !passed && body.unsure ? 1 : 0,
          suspects,
          notes: body.notes,
          outcome: passed ? ("passed" as const) : ("not_sent_back" as const),
          outcomeBy: passed ? c.get("userId") : null,
          outcomeAt: passed ? now : null,
        }),
      )
      .returning()
      .get();

    if (passed) {
      await recordAction(db, teamId, {
        userId: c.get("userId"),
        partInstanceId: instance.id,
        processId: process.id,
        action: "completed",
      });
    }
    return c.json({ report, history }, 201);
  })
  /**
   * Sends a failed report's part back to an earlier step, as To Do or In Progress. Every step
   * after that one goes back to Waiting, so the part is made through each again, Quality Control
   * included.
   */
  .post("/:id/send-back", requireAuth, sendBackValidator, async (c) => {
    const { processId, status } = c.req.valid("json");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    if (!(await canQualityCheck(db, teamId, user(c)))) return c.json({ error: NOT_A_MANAGER }, 403);

    const report = await db
      .select()
      .from(qualityReports)
      .where(inTeam(qualityReports, teamId, eq(qualityReports.id, Number(c.req.param("id")))))
      .get();
    if (!report) return c.json({ error: "Report not found." }, 404);
    if (report.outcome !== "not_sent_back") {
      return c.json({ error: "This report's part has already been passed or sent back." }, 409);
    }

    const steps = await stepsOf(db, teamId, report.partInstanceId);
    const check = steps.find(
      (s) => s.processId === report.processId && (s.status === "todo" || s.status === "doing"),
    );
    if (!check) {
      return c.json(
        { error: `The part has moved on from ${report.processName} since this report.` },
        409,
      );
    }
    // The latest run of that step before the check, if the pipeline has it twice.
    const target = steps.filter((s) => s.processId === processId && s.index < check.index).pop();
    if (!target) {
      return c.json({ error: "Send it back to a step that comes before the check." }, 400);
    }
    const targetName = await db
      .select({ name: processes.name })
      .from(processes)
      .where(inTeam(processes, teamId, eq(processes.id, processId)))
      .get();

    const now = Date.now();
    await db.batch([
      db
        .update(partInstanceProcesses)
        .set({ status, completedAt: null, batchId: null })
        .where(inTeam(partInstanceProcesses, teamId, eq(partInstanceProcesses.id, target.id))),
      db
        .update(partInstanceProcesses)
        .set({ status: "waiting", completedAt: null, batchId: null })
        .where(
          inTeam(
            partInstanceProcesses,
            teamId,
            eq(partInstanceProcesses.partInstanceId, report.partInstanceId),
            gt(partInstanceProcesses.index, target.index),
          ),
        ),
      db
        .update(qualityReports)
        .set({
          outcome: "sent_back",
          sentBackProcessId: processId,
          sentBackProcessName: targetName?.name ?? `Process #${processId}`,
          sentBackStatus: status,
          outcomeBy: c.get("userId"),
          outcomeAt: now,
        })
        .where(
          inTeam(
            qualityReports,
            teamId,
            and(eq(qualityReports.id, report.id), eq(qualityReports.outcome, "not_sent_back")),
          ),
        ),
    ]);
    return c.json({ ok: true });
  });
