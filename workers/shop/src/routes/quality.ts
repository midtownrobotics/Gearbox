import {
  activeMembers,
  changedFields,
  inTeam,
  logTeamChange,
  requireAdmin,
  settingLabels,
  withTeam,
} from "@g3/auth";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createShopDb } from "../db";
import { shopManagers } from "../db/schema";
import { qualityCheck, qualityProcesses, saveQualityCheck } from "../lib/quality";
import { manifest } from "../manifest";
import type { AppEnv } from "../types";

// Quality Control, on Shop's Admin page (admins only): who the team's shop managers are, and
// whether every part ends with a quality check. Only shop managers and admins may check off a
// Quality Control step (lib/quality.ts).

const managerValidator = validator("json", (value, c): { manager: boolean } => {
  const manager = ((value ?? {}) as { manager?: unknown }).manager;
  if (typeof manager !== "boolean") {
    return c.json({ error: "manager must be true or false." }, 400) as never;
  }
  return { manager };
});

const settingsValidator = validator(
  "json",
  (value, c): { requireQualityCheck?: boolean; qualityProcessId?: number | null } => {
    const v = (value ?? {}) as { requireQualityCheck?: unknown; qualityProcessId?: unknown };
    const out: { requireQualityCheck?: boolean; qualityProcessId?: number | null } = {};
    if (v.requireQualityCheck !== undefined) {
      if (typeof v.requireQualityCheck !== "boolean") {
        return c.json({ error: "requireQualityCheck must be a boolean." }, 400) as never;
      }
      out.requireQualityCheck = v.requireQualityCheck;
    }
    if (v.qualityProcessId !== undefined) {
      if (
        v.qualityProcessId !== null &&
        (!Number.isInteger(v.qualityProcessId) || (v.qualityProcessId as number) < 1)
      ) {
        return c.json(
          { error: "qualityProcessId must be a positive integer or null." },
          400,
        ) as never;
      }
      out.qualityProcessId = v.qualityProcessId as number | null;
    }
    if (Object.keys(out).length === 0) {
      return c.json(
        { error: "Provide requireQualityCheck and/or qualityProcessId." },
        400,
      ) as never;
    }
    return out;
  },
);

export const qualityRouter = new Hono<AppEnv>()
  /** The team's shop managers among its members, its Quality Control steps, and the setting. */
  .get("/", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const [check, steps, rows, members] = await Promise.all([
      qualityCheck(db, teamId),
      qualityProcesses(db, teamId),
      db
        .select({ userId: shopManagers.userId })
        .from(shopManagers)
        .where(inTeam(shopManagers, teamId))
        .all(),
      activeMembers(c.env, teamId),
    ]);
    const managerIds = new Set(rows.map((r) => r.userId));
    // Without the member list (G3ID unreachable) the managers are still shown, by id.
    const people = members
      ? members
          .map((m) => ({
            id: m.id,
            displayName: m.displayName,
            isAdmin: m.isAdmin,
            isMentor: m.isMentor,
            isManager: managerIds.has(m.id),
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
      : [...managerIds].map((id) => ({
          id,
          displayName: id,
          isAdmin: false,
          isMentor: false,
          isManager: true,
        }));
    return c.json({
      requireQualityCheck: check.required,
      qualityProcessId: check.processId,
      qualityProcesses: steps,
      people,
      peopleLoaded: Boolean(members),
    });
  })
  /** Makes one of the team's members a shop manager, or takes it away. */
  .put("/managers/:userId", requireAdmin, managerValidator, async (c) => {
    const userId = c.req.param("userId");
    const { manager } = c.req.valid("json");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");

    if (manager) {
      const members = await activeMembers(c.env, teamId);
      if (!members) return c.json({ error: "Couldn't load the team's members. Try again." }, 502);
      if (!members.some((m) => m.id === userId)) {
        return c.json({ error: "That person isn't an active member of the team." }, 404);
      }
      await db
        .insert(shopManagers)
        .values(withTeam(teamId, { userId, addedBy: c.get("userId"), addedAt: Date.now() }))
        .onConflictDoNothing();
    } else {
      await db
        .delete(shopManagers)
        .where(inTeam(shopManagers, teamId, eq(shopManagers.userId, userId)));
    }

    await logTeamChange(c.env, teamId, {
      userId: c.get("userId"),
      app: "shop",
      what: "Shop managers",
    });
    return c.json({ userId, isManager: manager });
  })
  /** Whether every part ends with a quality check, and which Quality Control step it is. */
  .put("/settings", requireAdmin, settingsValidator, async (c) => {
    const body = c.req.valid("json");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const before = await qualityCheck(db, teamId);

    const next = {
      required: body.requireQualityCheck ?? before.required,
      processId: body.qualityProcessId === undefined ? before.processId : body.qualityProcessId,
    };

    const refused = await saveQualityCheck(db, teamId, next);
    if (refused) return c.json({ error: refused }, 400);

    const changed = changedFields(
      { requireQualityCheck: before.required, qualityProcessId: before.processId },
      { requireQualityCheck: next.required, qualityProcessId: next.processId },
    );
    if (changed.length > 0) {
      await logTeamChange(c.env, teamId, {
        userId: c.get("userId"),
        app: "shop",
        what: "Quality control",
        changed: settingLabels(manifest, changed),
      });
    }
    return c.json({ requireQualityCheck: next.required, qualityProcessId: next.processId });
  });
