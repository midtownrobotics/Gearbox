import { inTeam, requireAuth, withTeam } from "@g3/auth";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { validator } from "hono/validator";
import { createShopDb } from "../db";
import { PROCESS_TYPES, type ProcessType, processes } from "../db/schema";
import { forgetQualityCheck } from "../lib/quality";
import type { AppEnv } from "../types";

const isProcessType = (v: unknown): v is ProcessType =>
  typeof v === "string" && (PROCESS_TYPES as readonly string[]).includes(v);

const createProcessValidator = validator(
  "json",
  (value, c): { name: string; type: ProcessType; requiresPartInfo: boolean } => {
    const v = (value ?? {}) as { name?: unknown; type?: unknown; requiresPartInfo?: unknown };
    const name = typeof v.name === "string" ? v.name.trim() : "";
    if (!name) return c.json({ error: "name is required." }, 400) as never;
    if (v.type !== undefined && !isProcessType(v.type)) {
      return c.json({ error: `type must be one of: ${PROCESS_TYPES.join(", ")}.` }, 400) as never;
    }
    if (v.requiresPartInfo !== undefined && typeof v.requiresPartInfo !== "boolean") {
      return c.json({ error: "requiresPartInfo must be a boolean." }, 400) as never;
    }
    return { name, type: v.type ?? "regular", requiresPartInfo: v.requiresPartInfo ?? false };
  },
);

const updateProcessValidator = validator(
  "json",
  (value, c): { type?: ProcessType; requiresPartInfo?: boolean } => {
    const v = (value ?? {}) as { type?: unknown; requiresPartInfo?: unknown };
    const out: { type?: ProcessType; requiresPartInfo?: boolean } = {};
    if (v.type !== undefined) {
      if (!isProcessType(v.type)) {
        return c.json({ error: `type must be one of: ${PROCESS_TYPES.join(", ")}.` }, 400) as never;
      }
      out.type = v.type;
    }
    if (v.requiresPartInfo !== undefined) {
      if (typeof v.requiresPartInfo !== "boolean") {
        return c.json({ error: "requiresPartInfo must be a boolean." }, 400) as never;
      }
      out.requiresPartInfo = v.requiresPartInfo;
    }
    if (Object.keys(out).length === 0) {
      return c.json({ error: "Provide type and/or requiresPartInfo." }, 400) as never;
    }
    return out;
  },
);

/**
 * A Quality Control step is a permission boundary (only shop managers and admins check one off),
 * so only an admin may make one, or take the type away again.
 */
const qualityTypeNeedsAdmin = (c: Context<AppEnv>, ...types: (ProcessType | undefined)[]) =>
  types.includes("quality_control") && !c.get("userIsAdmin");

export const processesRouter = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const rows = await db
      .select()
      .from(processes)
      .where(inTeam(processes, c.get("teamId")))
      .all();
    return c.json(rows);
  })
  .post("/", requireAuth, createProcessValidator, async (c) => {
    const { name, type, requiresPartInfo } = c.req.valid("json");
    if (qualityTypeNeedsAdmin(c, type)) {
      return c.json({ error: "Only an admin can add a Quality Control process." }, 403);
    }

    const db = createShopDb(c.env.SHOP_DB);
    const row = await db
      .insert(processes)
      .values(
        withTeam(c.get("teamId"), {
          name,
          type,
          requiresPartInfo: requiresPartInfo ? 1 : 0,
          createdAt: Date.now(),
        }),
      )
      .returning()
      .get();

    return c.json(row, 201);
  })
  .patch("/:id", requireAuth, updateProcessValidator, async (c) => {
    const id = Number(c.req.param("id"));
    const { type, requiresPartInfo } = c.req.valid("json");

    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    if (type !== undefined) {
      const current = await db
        .select({ type: processes.type })
        .from(processes)
        .where(inTeam(processes, teamId, eq(processes.id, id)))
        .get();
      if (!current) return c.json({ error: "Process not found." }, 404);
      if (qualityTypeNeedsAdmin(c, type, current.type)) {
        return c.json({ error: "Only an admin can change a Quality Control process's type." }, 403);
      }
    }
    const row = await db
      .update(processes)
      .set({
        ...(type !== undefined && { type }),
        ...(requiresPartInfo !== undefined && { requiresPartInfo: requiresPartInfo ? 1 : 0 }),
      })
      .where(inTeam(processes, teamId, eq(processes.id, id)))
      .returning()
      .get();

    if (!row) return c.json({ error: "Process not found." }, 404);
    if (type !== undefined && type !== "quality_control") {
      await forgetQualityCheck(db, teamId, id);
    }
    return c.json(row);
  });
