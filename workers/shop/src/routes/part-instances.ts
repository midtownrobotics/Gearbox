import { inTeam, requireAuth, withTeam } from "@g3/auth";
import { asc, eq, max } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createShopDb } from "../db";
import {
  partDefinitionProcessBlueprints,
  partDefinitions,
  partInstanceProcesses,
  partInstances,
} from "../db/schema";
import type { AppEnv } from "../types";

const createInstancesValidator = validator(
  "json",
  (value, c): { partDefinitionId: number; quantity: number } => {
    const v = (value ?? {}) as { partDefinitionId?: unknown; quantity?: unknown };
    if (!Number.isInteger(v.partDefinitionId) || (v.partDefinitionId as number) < 1)
      return c.json({ error: "partDefinitionId must be a positive integer." }, 400) as never;
    if (!Number.isInteger(v.quantity) || (v.quantity as number) < 1)
      return c.json({ error: "quantity must be a positive integer." }, 400) as never;
    return { partDefinitionId: v.partDefinitionId as number, quantity: v.quantity as number };
  },
);

const updateInstanceValidator = validator(
  "json",
  (value): { isPriority?: boolean; isStale?: boolean } => {
    const v = (value ?? {}) as { isPriority?: unknown; isStale?: unknown };
    const out: { isPriority?: boolean; isStale?: boolean } = {};
    if (typeof v.isPriority === "boolean") out.isPriority = v.isPriority;
    if (typeof v.isStale === "boolean") out.isStale = v.isStale;
    return out;
  },
);

export const partInstancesRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const partDefinitionId = c.req.query("partDefinitionId");
    const db = createShopDb(c.env.SHOP_DB);
    const rows = await db
      .select()
      .from(partInstances)
      .where(
        inTeam(
          partInstances,
          c.get("teamId"),
          partDefinitionId
            ? eq(partInstances.partDefinitionId, Number(partDefinitionId))
            : undefined,
        ),
      )
      .all();
    return c.json(rows);
  })
  .post("/", requireAuth, createInstancesValidator, async (c) => {
    const { partDefinitionId, quantity } = c.req.valid("json");

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const now = Date.now();

    const definition = await db
      .select({ id: partDefinitions.id })
      .from(partDefinitions)
      .where(inTeam(partDefinitions, teamId, eq(partDefinitions.id, partDefinitionId)))
      .get();
    if (!definition) return c.json({ error: "Part definition not found." }, 404);

    let rows: (typeof partInstances.$inferSelect)[] | null = null;
    let retries = 0;
    const maxRetries = 5;

    while (!rows && retries < maxRetries) {
      try {
        const result = await db
          .select({ maxInstance: max(partInstances.instanceNumber) })
          .from(partInstances)
          .where(
            inTeam(partInstances, teamId, eq(partInstances.partDefinitionId, partDefinitionId)),
          )
          .get();

        const nextNumber = (result?.maxInstance ?? 0) + 1;

        rows = await db
          .insert(partInstances)
          .values(
            withTeam(
              teamId,
              Array.from({ length: quantity }, (_, i) => ({
                partDefinitionId,
                instanceNumber: nextNumber + i,
                createdAt: now,
              })),
            ),
          )
          .returning()
          .all();
      } catch (err) {
        retries++;
        if (retries >= maxRetries) {
          throw err;
        }
        // Exponential backoff: 10ms, 20ms, 40ms, 80ms, 160ms
        await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** (retries - 1)));
      }
    }

    if (!rows) {
      return c.json({ error: "Failed to create part instances after retries" }, 500);
    }

    // Copy the part definition's process blueprint onto each new instance.
    // The first process is ready to start (todo); the rest are blocked (waiting).
    try {
      const blueprints = await db
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

      if (blueprints.length > 0) {
        const processRecords = rows.flatMap((instance) =>
          blueprints.map((bp, i) => ({
            partInstanceId: instance.id,
            processId: bp.processId,
            index: bp.index,
            status: (i === 0 ? "todo" : "waiting") as "todo" | "waiting",
            createdAt: now,
          })),
        );

        // Insert in smaller batches to avoid SQLite limits (max ~500 params per statement)
        // With ~4 columns per row, 10 rows per batch is conservative and safe
        const batchSize = 10;
        for (let i = 0; i < processRecords.length; i += batchSize) {
          const batch = processRecords.slice(i, i + batchSize);
          await db.insert(partInstanceProcesses).values(withTeam(teamId, batch));
        }
      }
    } catch (err) {
      console.error("[Part Instances] Failed to assign processes to instances:", err);
      return c.json(
        {
          error:
            "Failed to assign processes to instances. Instances were created but have no processes.",
          details: err instanceof Error ? err.message : "Unknown error",
        },
        500,
      );
    }

    return c.json(rows, 201);
  })
  .patch("/:id", requireAuth, updateInstanceValidator, async (c) => {
    const id = Number(c.req.param("id"));
    const body = c.req.valid("json");

    const updates: Partial<{ isPriority: number; isStale: number }> = {};
    if (body.isPriority !== undefined) updates.isPriority = body.isPriority ? 1 : 0;
    if (body.isStale !== undefined) updates.isStale = body.isStale ? 1 : 0;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No updatable fields provided." }, 400);
    }

    const db = createShopDb(c.env.SHOP_DB);
    const row = await db
      .update(partInstances)
      .set(updates)
      .where(inTeam(partInstances, c.get("teamId"), eq(partInstances.id, id)))
      .returning()
      .get();

    if (!row) return c.json({ error: "Part instance not found." }, 404);
    return c.json(row);
  });
