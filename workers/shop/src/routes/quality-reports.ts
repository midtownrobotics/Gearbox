import { inTeam, requireAdmin, requireAuth, withTeam } from "@g3/auth";
import { and, asc, desc, eq, gt, gte, inArray, lt, max, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { type Context, Hono } from "hono";
import { validator } from "hono/validator";
import { createShopDb } from "../db";
import {
  type QualityAnswer,
  type QualitySuspect,
  actions,
  partDefinitionProcessBlueprints,
  partDefinitions,
  partInstanceProcesses,
  partInstances,
  processes,
  qualityReports,
} from "../db/schema";
import { canQualityCheck, qualityReportsOn } from "../lib/quality";
import { MAX_CHECKLIST_ITEMS, checklistFor } from "../lib/quality-checklist";
import { removedError } from "../lib/removal";
import { finished, promoteNextSteps } from "../lib/steps";
import type { AppEnv } from "../types";
import { recordAction } from "./actions";

// Quality reports: with the team's quality reports on, a part at a Quality Control step is checked
// with a report instead of Mark Complete. Four checks (each ticked even when it doesn't apply to
// the part); when one fails, the steps it likely came from (or Unsure) and notes. A passing report
// finishes the step; a failing one leaves the part there until it's sent back. Only shop managers
// and admins write reports, and admins read them on the Admin page.

type ShopDb = ReturnType<typeof createShopDb>;

type ReportInput = {
  partInstanceId: number;
  processId: number;
  /** One answer per line of the team's checklist, as the reporter was shown it. */
  checks: QualityAnswer[];
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
  if (!Array.isArray(v.checks) || v.checks.length === 0) {
    return bad("checks must be the checklist, each line with its answer.");
  }
  if (v.checks.length > MAX_CHECKLIST_ITEMS) return bad("That's more lines than a checklist has.");
  const checks: QualityAnswer[] = [];
  for (const raw of v.checks) {
    const line = (raw ?? {}) as { label?: unknown; ok?: unknown };
    if (typeof line.label !== "string" || typeof line.ok !== "boolean") {
      return bad("Every line of checks needs a label and an answer.");
    }
    checks.push({ label: line.label.trim(), ok: line.ok });
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
    checks,
    suspectProcessIds: [...new Set(suspects as number[])],
    unsure: v.unsure === true,
    notes: notes || null,
  };
});

const sendBackValidator = validator(
  "json",
  (value, c): { processId: number; status: "todo" | "doing"; fix: boolean; fixNote: string } => {
    const v = (value ?? {}) as {
      processId?: unknown;
      status?: unknown;
      fix?: unknown;
      fixNote?: unknown;
    };
    const bad = (error: string) => c.json({ error }, 400) as never;
    if (!isId(v.processId)) return bad("processId must be a positive integer.");
    if (v.status !== "todo" && v.status !== "doing") {
      return bad("status must be 'todo' or 'doing'.");
    }
    if (v.fix !== undefined && typeof v.fix !== "boolean") return bad("fix must be true or false.");
    if (v.fixNote !== undefined && v.fixNote !== null && typeof v.fixNote !== "string") {
      return bad("fixNote must be text.");
    }
    const fixNote = typeof v.fixNote === "string" ? v.fixNote.trim() : "";
    if (fixNote.length > 2000) return bad("A fix note can be 2,000 characters at most.");
    // A fix is what gets written onto the part, so it can't be blank.
    if (v.fix === true && !fixNote) return bad("Say what has to be done to fix the part.");
    if (v.fix !== true && fixNote) return bad("fixNote is only for a fix.");
    return { processId: v.processId, status: v.status, fix: v.fix === true, fixNote };
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

/**
 * A failed report still waiting to be dealt with, its part's steps, and the check the part is
 * standing at. Every outcome route starts here, so none of them acts on a part someone else has
 * already moved on.
 */
async function openReport(
  db: ShopDb,
  teamId: string,
  id: number,
): Promise<
  | { error: string; status: 404 | 409 }
  | {
      report: typeof qualityReports.$inferSelect;
      steps: (typeof partInstanceProcesses.$inferSelect)[];
      check: typeof partInstanceProcesses.$inferSelect;
    }
> {
  const report = await db
    .select()
    .from(qualityReports)
    .where(inTeam(qualityReports, teamId, eq(qualityReports.id, id)))
    .get();
  if (!report) return { error: "Report not found.", status: 404 };
  if (report.outcome !== "not_sent_back") {
    return { error: "This report's part has already been dealt with.", status: 409 };
  }
  const steps = await stepsOf(db, teamId, report.partInstanceId);
  const check = steps.find(
    (s) => s.processId === report.processId && (s.status === "todo" || s.status === "doing"),
  );
  if (!check) {
    return {
      error: `The part has moved on from ${report.processName} since this report.`,
      status: 409,
    };
  }
  return { report, steps, check };
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

    // The report is answered against the team's list as it stands now. If an admin changed it
    // while this form was open, the reporter checked a different part than we'd be recording.
    const checklist = await checklistFor(db, teamId);
    const answered = body.checks.map((a) => a.label);
    if (checklist.length !== answered.length || checklist.some((l, i) => l !== answered[i])) {
      return c.json(
        { error: "The checklist has changed. Open the report again to check the part against it." },
        409,
      );
    }

    const passed = body.checks.every((a) => a.ok);
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
          checks: body.checks,
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
   * Sends a failed report's part to any step it has, as To Do or In Progress. Every step after
   * that one goes back to Waiting, so the part is made through each again, Quality Control
   * included. With `fix`, the note is added to the part's notes so whoever picks it up reads what
   * has to be done, and the report is a fix rather than a plain send back.
   */
  .post("/:id/send-back", requireAuth, sendBackValidator, async (c) => {
    const { processId, status, fix, fixNote } = c.req.valid("json");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    if (!(await canQualityCheck(db, teamId, user(c)))) return c.json({ error: NOT_A_MANAGER }, 403);

    const open = await openReport(db, teamId, Number(c.req.param("id")));
    if ("error" in open) return c.json({ error: open.error }, open.status);
    const { report, steps, check } = open;

    const chosen = await db
      .select({
        id: processes.id,
        name: processes.name,
        type: processes.type,
        archivedAt: processes.archivedAt,
      })
      .from(processes)
      .where(inTeam(processes, teamId, eq(processes.id, processId)))
      .get();
    if (!chosen) return c.json({ error: "Process not found." }, 404);

    // Any step of the part: the latest run before the check if it has one (the usual case, and
    // the right one when the pipeline holds the same process twice), else its first run after.
    const runs = steps.filter((s) => s.processId === processId);
    const target = runs.filter((s) => s.index < check.index).pop() ?? runs[0];
    // A fix can send the part to a process it has never been through (sanding a failed part), and
    // that step joins this one part's list, just before the check. Only a plain process: a File
    // Producer or Consumer has to be paired across the whole list, and a second Quality Control
    // step would be a second check.
    if (!target) {
      if (!fix) return c.json({ error: "Send it back to a step this part has." }, 400);
      if (chosen.type !== "regular") {
        return c.json(
          { error: `${chosen.name} can't be added to one part. Pick a plain process.` },
          400,
        );
      }
      const removed = chosen.archivedAt !== null && removedError("process", [chosen]);
      if (removed) return c.json({ error: removed }, 400);
    }

    // The note goes on the part definition, which is what the shop view shows as Notes.
    const definition = fix
      ? await db
          .select({ id: partDefinitions.id, notes: partDefinitions.notes })
          .from(partDefinitions)
          .where(inTeam(partDefinitions, teamId, eq(partDefinitions.id, report.partDefinitionId)))
          .get()
      : null;
    if (fix && !definition) return c.json({ error: "Part not found." }, 404);

    const now = Date.now();
    // Where the part ends up waiting, and so which steps have to be done over.
    const landsAt = target ? target.index : check.index;
    const writes: BatchItem<"sqlite">[] = target
      ? [
          db
            .update(partInstanceProcesses)
            .set({ status, completedAt: null, batchId: null })
            .where(inTeam(partInstanceProcesses, teamId, eq(partInstanceProcesses.id, target.id))),
        ]
      : [
          // Open a gap at the check's index for the new step. The shift goes through negative
          // indexes so it never collides with a row it hasn't moved yet; the batch is one
          // transaction, so nothing outside it sees them.
          db
            .update(partInstanceProcesses)
            .set({ index: sql`-(${partInstanceProcesses.index} + 1)` })
            .where(
              inTeam(
                partInstanceProcesses,
                teamId,
                eq(partInstanceProcesses.partInstanceId, report.partInstanceId),
                gte(partInstanceProcesses.index, check.index),
              ),
            ),
          db
            .update(partInstanceProcesses)
            .set({ index: sql`-${partInstanceProcesses.index}` })
            .where(
              inTeam(
                partInstanceProcesses,
                teamId,
                eq(partInstanceProcesses.partInstanceId, report.partInstanceId),
                lt(partInstanceProcesses.index, 0),
              ),
            ),
          db.insert(partInstanceProcesses).values(
            withTeam(teamId, {
              partInstanceId: report.partInstanceId,
              processId,
              index: check.index,
              status,
              createdAt: now,
            }),
          ),
        ];
    writes.push(
      db
        .update(partInstanceProcesses)
        .set({ status: "waiting", completedAt: null, batchId: null })
        .where(
          inTeam(
            partInstanceProcesses,
            teamId,
            eq(partInstanceProcesses.partInstanceId, report.partInstanceId),
            gt(partInstanceProcesses.index, landsAt),
          ),
        ),
      db
        .update(qualityReports)
        .set({
          outcome: fix ? "fixed" : "sent_back",
          sentBackProcessId: processId,
          sentBackProcessName: chosen.name,
          sentBackStatus: status,
          fixNote: fix ? fixNote : null,
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
    );
    if (definition) {
      const line = `Fix for #${report.instanceNumber}: ${fixNote}`;
      const before = definition.notes?.trim();
      writes.push(
        db
          .update(partDefinitions)
          .set({ notes: before ? `${before}\n${line}` : line })
          .where(inTeam(partDefinitions, teamId, eq(partDefinitions.id, definition.id))),
      );
    }
    const [first, ...rest] = writes;
    await db.batch([first, ...rest]);
    return c.json({ ok: true });
  })
  /**
   * Starts the part over: makes the failed report's part obsolete and adds a new one of the same
   * part, with the part's steps from the start. The report is claimed before the new part is made,
   * so two taps can't leave two replacements.
   */
  .post("/:id/replace", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    if (!(await canQualityCheck(db, teamId, user(c)))) return c.json({ error: NOT_A_MANAGER }, 403);

    const open = await openReport(db, teamId, Number(c.req.param("id")));
    if ("error" in open) return c.json({ error: open.error }, open.status);
    const { report } = open;

    const now = Date.now();
    const claimed = await db
      .update(qualityReports)
      .set({ outcome: "replaced", outcomeBy: c.get("userId"), outcomeAt: now })
      .where(
        inTeam(
          qualityReports,
          teamId,
          and(eq(qualityReports.id, report.id), eq(qualityReports.outcome, "not_sent_back")),
        ),
      )
      .returning({ id: qualityReports.id })
      .get();
    if (!claimed) {
      return c.json({ error: "This report's part has already been dealt with." }, 409);
    }

    const [highest, blueprints] = await Promise.all([
      db
        .select({ max: max(partInstances.instanceNumber) })
        .from(partInstances)
        .where(
          inTeam(
            partInstances,
            teamId,
            eq(partInstances.partDefinitionId, report.partDefinitionId),
          ),
        )
        .get(),
      db
        .select()
        .from(partDefinitionProcessBlueprints)
        .where(
          inTeam(
            partDefinitionProcessBlueprints,
            teamId,
            eq(partDefinitionProcessBlueprints.partDefinitionId, report.partDefinitionId),
          ),
        )
        .orderBy(asc(partDefinitionProcessBlueprints.index))
        .all(),
    ]);

    const replacement = await db
      .insert(partInstances)
      .values(
        withTeam(teamId, {
          partDefinitionId: report.partDefinitionId,
          instanceNumber: (highest?.max ?? 0) + 1,
          createdAt: now,
        }),
      )
      .returning()
      .get();

    if (blueprints.length > 0) {
      await db.insert(partInstanceProcesses).values(
        withTeam(
          teamId,
          blueprints.map((bp, i) => ({
            partInstanceId: replacement.id,
            processId: bp.processId,
            index: bp.index,
            status: (i === 0 ? "todo" : "waiting") as "todo" | "waiting",
            createdAt: now,
          })),
        ),
      );
    }

    await db.batch([
      db
        .update(partInstances)
        .set({ isStale: 1, obsoletedAt: now, obsoletedBy: c.get("userId") })
        .where(inTeam(partInstances, teamId, eq(partInstances.id, report.partInstanceId))),
      db
        .update(qualityReports)
        .set({
          replacementInstanceId: replacement.id,
          replacementInstanceNumber: replacement.instanceNumber,
        })
        .where(inTeam(qualityReports, teamId, eq(qualityReports.id, report.id))),
    ]);

    return c.json({ replacement });
  });
