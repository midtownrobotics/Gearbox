import { inTeam, requireAuth, withTeam } from "@g3/auth";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createShopDb } from "../db";
import {
  partDefinitionProcessBlueprints,
  partDefinitions,
  processes,
  projects,
  subsystems,
} from "../db/schema";
import { fileStepError } from "../lib/process-rules";
import { withQualityStep } from "../lib/quality";
import { removedError } from "../lib/removal";
import type { AppEnv } from "../types";

const updatePartValidator = validator(
  "json",
  (
    value,
  ): {
    onshapePartNumber?: string;
    revision?: string;
    subsystemId?: number;
    name?: string;
    notes?: string | null;
    partDrawingUrl?: string | null;
    material?: string | null;
    thickness?: string | null;
  } => {
    const v = (value ?? {}) as Record<string, unknown>;
    const out: {
      onshapePartNumber?: string;
      revision?: string;
      subsystemId?: number;
      name?: string;
      notes?: string | null;
      partDrawingUrl?: string | null;
      material?: string | null;
      thickness?: string | null;
    } = {};
    if (typeof v.onshapePartNumber === "string") out.onshapePartNumber = v.onshapePartNumber;
    if (typeof v.revision === "string") out.revision = v.revision;
    if (typeof v.subsystemId === "number") out.subsystemId = v.subsystemId;
    if (typeof v.name === "string") out.name = v.name;
    if (v.notes === null || typeof v.notes === "string") out.notes = v.notes;
    if (v.partDrawingUrl === null || typeof v.partDrawingUrl === "string")
      out.partDrawingUrl = v.partDrawingUrl;
    if (v.material === null || typeof v.material === "string")
      out.material = v.material?.trim() || null;
    if (v.thickness === null || typeof v.thickness === "string")
      out.thickness = v.thickness?.trim() || null;
    return out;
  },
);

const addBlueprintValidator = validator(
  "json",
  (value, c): { index: number; processId: number } => {
    const v = (value ?? {}) as { index?: unknown; processId?: unknown };
    if (!Number.isInteger(v.index) || (v.index as number) < 0)
      return c.json({ error: "index must be a non-negative integer." }, 400) as never;
    if (!Number.isInteger(v.processId) || (v.processId as number) < 1)
      return c.json({ error: "processId must be a positive integer." }, 400) as never;
    return { index: v.index as number, processId: v.processId as number };
  },
);

const replaceBlueprintValidator = validator("json", (value, c): { processIds: number[] } => {
  const v = (value ?? {}) as { processIds?: unknown };
  if (
    !Array.isArray(v.processIds) ||
    v.processIds.length > 25 ||
    v.processIds.some((p) => !Number.isInteger(p) || p < 1)
  ) {
    return c.json(
      { error: "processIds must be an array of up to 25 positive integers." },
      400,
    ) as never;
  }
  return { processIds: v.processIds as number[] };
});

const reorderBlueprintValidator = validator("json", (value, c): { processIds: number[] } => {
  const v = (value ?? {}) as { processIds?: unknown };
  if (!Array.isArray(v.processIds) || v.processIds.some((p) => !Number.isInteger(p)))
    return c.json({ error: "processIds must be an array of integers." }, 400) as never;
  return { processIds: v.processIds as number[] };
});

type ShopDb = ReturnType<typeof createShopDb>;

/**
 * What's wrong with a part's process list, or null: a process that isn't the team's, one removed
 * on the Admin page (unless the part already has it: `kept`), or File Producer steps without File
 * Consumer ones (or the other way round).
 */
async function processListError(
  db: ShopDb,
  teamId: string,
  processIds: number[],
  kept: number[] = [],
): Promise<string | null> {
  if (processIds.length === 0) return null;
  const steps = await db
    .select({
      id: processes.id,
      name: processes.name,
      type: processes.type,
      archivedAt: processes.archivedAt,
    })
    .from(processes)
    .where(inTeam(processes, teamId, inArray(processes.id, processIds)))
    .all();
  if (new Set(steps.map((s) => s.id)).size !== new Set(processIds).size) {
    return "Some of those processes don't exist.";
  }
  const removed = removedError(
    "process",
    steps.filter((s) => s.archivedAt !== null && !kept.includes(s.id)),
  );
  if (removed) return removed;
  // In the order the part goes through them, which is what the rule is about.
  const byId = new Map(steps.map((s) => [s.id, s]));
  return fileStepError(processIds.flatMap((id) => byId.get(id) ?? []));
}

/**
 * Why a part can't be filed under this subsystem, or null: it isn't the team's, or it (or its
 * project) was removed on the Admin page and isn't the one the part already has (`current`).
 */
async function subsystemError(db: ShopDb, teamId: string, id: number, current?: number) {
  const row = await db
    .select({
      name: subsystems.name,
      archivedAt: subsystems.archivedAt,
      project: projects.name,
      projectArchivedAt: projects.archivedAt,
    })
    .from(subsystems)
    .innerJoin(projects, eq(projects.id, subsystems.projectId))
    .where(and(inTeam(subsystems, teamId, eq(subsystems.id, id)), inTeam(projects, teamId)))
    .get();
  if (!row) return "That subsystem doesn't exist.";
  if (id === current) return null;
  if (row.projectArchivedAt !== null) return removedError("project", [{ name: row.project }]);
  return row.archivedAt !== null ? removedError("subsystem", [row]) : null;
}

/** The ids of the subsystems in this subsystem's project: the parts that share its part numbers. */
const projectSubsystems = (db: ShopDb, teamId: string, subsystemId: number) =>
  db
    .select({ id: subsystems.id })
    .from(subsystems)
    .where(
      inTeam(
        subsystems,
        teamId,
        eq(
          subsystems.projectId,
          db
            .select({ projectId: subsystems.projectId })
            .from(subsystems)
            .where(inTeam(subsystems, teamId, eq(subsystems.id, subsystemId))),
        ),
      ),
    );

/** The team's part definition, if it is one. */
async function teamPart(db: ShopDb, teamId: string, id: number) {
  return db
    .select({ id: partDefinitions.id })
    .from(partDefinitions)
    .where(inTeam(partDefinitions, teamId, eq(partDefinitions.id, id)))
    .get();
}

/** A part definition's blueprint, in order. */
function blueprintOf(db: ShopDb, teamId: string, partDefinitionId: number) {
  return db
    .select()
    .from(partDefinitionProcessBlueprints)
    .where(
      inTeam(
        partDefinitionProcessBlueprints,
        teamId,
        eq(partDefinitionProcessBlueprints.partDefinitionId, partDefinitionId),
      ),
    )
    .orderBy(asc(partDefinitionProcessBlueprints.index))
    .all();
}

/**
 * Rewrites a part's blueprint in one batch. A delete + reinsert avoids tripping the
 * (partDefinitionId, index) unique constraint that in-place index swaps would.
 */
async function replaceBlueprint(
  db: ShopDb,
  teamId: string,
  partDefinitionId: number,
  processIds: number[],
) {
  const now = Date.now();
  const remove = db
    .delete(partDefinitionProcessBlueprints)
    .where(
      inTeam(
        partDefinitionProcessBlueprints,
        teamId,
        eq(partDefinitionProcessBlueprints.partDefinitionId, partDefinitionId),
      ),
    );
  // Five values a row: 20 rows a statement stays under D1's 100 bound parameters.
  const inserts = [];
  for (let i = 0; i < processIds.length; i += 20) {
    inserts.push(
      db.insert(partDefinitionProcessBlueprints).values(
        withTeam(
          teamId,
          processIds.slice(i, i + 20).map((processId, j) => ({
            partDefinitionId,
            processId,
            index: i + j,
            createdAt: now,
          })),
        ),
      ),
    );
  }
  await db.batch([remove, ...inserts]);
}

export const partDefinitionsRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const onshapePartNumber = c.req.query("onshapePartNumber");
    const rows = await db
      .select()
      .from(partDefinitions)
      .where(
        inTeam(
          partDefinitions,
          c.get("teamId"),
          onshapePartNumber ? eq(partDefinitions.onshapePartNumber, onshapePartNumber) : undefined,
        ),
      )
      .all();
    return c.json(rows);
  })
  .post("/", requireAuth, async (c) => {
    const body = await c.req.json<{
      onshapePartNumber: string;
      revision: string;
      subsystemId: number;
      name: string;
      notes?: string;
      partDrawingUrl?: string;
      processIds?: number[];
      obsoleteExisting?: boolean;
      material?: string;
      thickness?: string;
    }>();

    const {
      onshapePartNumber,
      revision,
      subsystemId,
      name,
      notes,
      partDrawingUrl,
      processIds,
      obsoleteExisting,
    } = body;
    const material = typeof body.material === "string" ? body.material.trim() || null : null;
    const thickness = typeof body.thickness === "string" ? body.thickness.trim() || null : null;
    if (!onshapePartNumber || !revision || !subsystemId || !name) {
      return c.json(
        { error: "onshapePartNumber, revision, subsystemId, and name are required." },
        400,
      );
    }

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const now = Date.now();

    const subsystemProblem = await subsystemError(db, teamId, subsystemId);
    if (subsystemProblem) return c.json({ error: subsystemProblem }, 400);

    // With a quality check required, it's the last step of every part.
    const pipeline = await withQualityStep(db, teamId, processIds ?? []);

    if (pipeline.length > 0 && (!material || !thickness)) {
      const needsInfo = await db
        .select({ name: processes.name })
        .from(processes)
        .where(
          inTeam(
            processes,
            teamId,
            inArray(processes.id, pipeline),
            eq(processes.requiresPartInfo, 1),
          ),
        )
        .all();
      if (needsInfo.length > 0) {
        return c.json(
          {
            error: `Material and thickness are required for ${needsInfo.map((p) => p.name).join(", ")}.`,
          },
          400,
        );
      }
    }

    const fileError = await processListError(db, teamId, pipeline);
    if (fileError) return c.json({ error: fileError }, 400);

    // If obsoleteExisting is true, mark all existing parts with same number in the same project
    // as obsolete, BUT exclude the new revision we're about to create
    if (obsoleteExisting) {
      try {
        await db
          .update(partDefinitions)
          .set({ isObsolete: 1 })
          .where(
            inTeam(
              partDefinitions,
              teamId,
              eq(partDefinitions.onshapePartNumber, onshapePartNumber),
              inArray(partDefinitions.subsystemId, projectSubsystems(db, teamId, subsystemId)),
              revision ? ne(partDefinitions.revision, revision) : sql`1=1`,
            ),
          );
      } catch (err) {
        console.error("[Part Definitions] Error marking obsolete parts", err);
        return c.json(
          { error: err instanceof Error ? err.message : "Failed to mark obsolete parts" },
          500,
        );
      }
    }

    const partDef = await db
      .insert(partDefinitions)
      .values(
        withTeam(teamId, {
          onshapePartNumber,
          revision,
          subsystemId,
          name,
          notes,
          partDrawingUrl,
          material,
          thickness,
          creator: c.get("userId"),
          createdAt: now,
        }),
      )
      .returning()
      .get();

    if (pipeline.length > 0) {
      // Five values a row: 20 rows a statement stays under D1's 100 bound parameters.
      for (let i = 0; i < pipeline.length; i += 20) {
        await db.insert(partDefinitionProcessBlueprints).values(
          withTeam(
            teamId,
            pipeline.slice(i, i + 20).map((processId, j) => ({
              partDefinitionId: partDef.id,
              processId,
              index: i + j,
              createdAt: now,
            })),
          ),
        );
      }
    }

    return c.json(partDef, 201);
  })
  .patch("/:id", requireAuth, updatePartValidator, async (c) => {
    const id = Number(c.req.param("id"));
    const body = c.req.valid("json");

    const updates: Partial<{
      onshapePartNumber: string;
      revision: string;
      subsystemId: number;
      name: string;
      notes: string | null;
      partDrawingUrl: string | null;
      material: string | null;
      thickness: string | null;
    }> = {};

    // Required fields: if provided, must be non-empty.
    if (body.onshapePartNumber !== undefined) {
      if (!body.onshapePartNumber.trim())
        return c.json({ error: "onshapePartNumber cannot be empty." }, 400);
      updates.onshapePartNumber = body.onshapePartNumber.trim();
    }
    if (body.revision !== undefined) {
      if (!body.revision.trim()) return c.json({ error: "revision cannot be empty." }, 400);
      updates.revision = body.revision.trim();
    }
    if (body.name !== undefined) {
      if (!body.name.trim()) return c.json({ error: "name cannot be empty." }, 400);
      updates.name = body.name.trim();
    }
    if (body.subsystemId !== undefined) {
      if (!Number.isInteger(body.subsystemId) || body.subsystemId < 1)
        return c.json({ error: "subsystemId must be a positive integer." }, 400);
      updates.subsystemId = body.subsystemId;
    }
    // Nullable fields: may be set to a value or cleared with null.
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.partDrawingUrl !== undefined) updates.partDrawingUrl = body.partDrawingUrl;
    if (body.material !== undefined) updates.material = body.material;
    if (body.thickness !== undefined) updates.thickness = body.thickness;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No updatable fields provided." }, 400);
    }

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    if (updates.subsystemId !== undefined) {
      const current = await db
        .select({ subsystemId: partDefinitions.subsystemId })
        .from(partDefinitions)
        .where(inTeam(partDefinitions, teamId, eq(partDefinitions.id, id)))
        .get();
      if (!current) return c.json({ error: "Part definition not found." }, 404);
      const subsystemProblem = await subsystemError(
        db,
        teamId,
        updates.subsystemId,
        current.subsystemId,
      );
      if (subsystemProblem) return c.json({ error: subsystemProblem }, 400);
    }
    const row = await db
      .update(partDefinitions)
      .set(updates)
      .where(inTeam(partDefinitions, teamId, eq(partDefinitions.id, id)))
      .returning()
      .get();

    if (!row) return c.json({ error: "Part definition not found." }, 404);
    return c.json(row);
  })
  .get("/:id/processes", requireAuth, async (c) => {
    const partDefinitionId = Number(c.req.param("id"));
    const db = createShopDb(c.env.SHOP_DB);
    return c.json(await blueprintOf(db, c.get("teamId"), partDefinitionId));
  })
  // Replaces the whole blueprint (processes may be added, removed, or reordered). Existing
  // instances keep their own pipelines; only instances created afterward use the new one.
  .put("/:id/processes", requireAuth, replaceBlueprintValidator, async (c) => {
    const partDefinitionId = Number(c.req.param("id"));
    const { processIds } = c.req.valid("json");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");

    if (!(await teamPart(db, teamId, partDefinitionId))) {
      return c.json({ error: "Part definition not found." }, 404);
    }

    const pipeline = await withQualityStep(db, teamId, processIds);
    // A process removed on the Admin page stays on a part that already has it.
    const kept = (await blueprintOf(db, teamId, partDefinitionId)).map((b) => b.processId);
    const fileError = await processListError(db, teamId, pipeline, kept);
    if (fileError) return c.json({ error: fileError }, 400);

    await replaceBlueprint(db, teamId, partDefinitionId, pipeline);
    return c.json(await blueprintOf(db, teamId, partDefinitionId));
  })
  .patch("/:id/processes/reorder", requireAuth, reorderBlueprintValidator, async (c) => {
    const partDefinitionId = Number(c.req.param("id"));
    const { processIds } = c.req.valid("json");

    if (processIds.length === 0) {
      return c.json({ error: "processIds must be a non-empty array of integers." }, 400);
    }

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const existing = await blueprintOf(db, teamId, partDefinitionId);

    const existingIds = existing.map((b) => b.processId).sort((a, b) => a - b);
    const givenIds = [...processIds].sort((a, b) => a - b);
    if (
      existingIds.length !== givenIds.length ||
      !existingIds.every((pid, i) => pid === givenIds[i])
    ) {
      return c.json(
        { error: "processIds must contain every blueprint process exactly once." },
        400,
      );
    }
    const orderError = await processListError(db, teamId, processIds, existingIds);
    if (orderError) return c.json({ error: orderError }, 400);

    await replaceBlueprint(
      db,
      teamId,
      partDefinitionId,
      await withQualityStep(db, teamId, processIds),
    );
    return c.json(await blueprintOf(db, teamId, partDefinitionId));
  })
  .post("/:id/processes", requireAuth, addBlueprintValidator, async (c) => {
    const partDefinitionId = Number(c.req.param("id"));
    const { index, processId } = c.req.valid("json");

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    if (!(await teamPart(db, teamId, partDefinitionId))) {
      return c.json({ error: "Part definition not found." }, 404);
    }
    const processError = await processListError(db, teamId, [processId]);
    if (processError) return c.json({ error: processError }, 400);
    const row = await db
      .insert(partDefinitionProcessBlueprints)
      .values(withTeam(teamId, { partDefinitionId, processId, index, createdAt: Date.now() }))
      .returning()
      .get();

    return c.json(row, 201);
  })
  .delete("/:id/processes/:processId", requireAuth, async (c) => {
    const partDefinitionId = Number(c.req.param("id"));
    const processId = Number(c.req.param("processId"));

    const db = createShopDb(c.env.SHOP_DB);
    await db
      .delete(partDefinitionProcessBlueprints)
      .where(
        inTeam(
          partDefinitionProcessBlueprints,
          c.get("teamId"),
          eq(partDefinitionProcessBlueprints.partDefinitionId, partDefinitionId),
          eq(partDefinitionProcessBlueprints.processId, processId),
        ),
      );

    return c.json({ ok: true });
  });
