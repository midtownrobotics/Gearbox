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
import { qualityCheck, qualityProcesses, qualityReportsOn, saveQualityCheck } from "../lib/quality";
import { SETTING, setSetting } from "../lib/settings";
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
  (
    value,
    c,
  ): {
    requireQualityCheck?: boolean;
    qualityProcessId?: number | null;
    qualityReports?: boolean;
  } => {
    const v = (value ?? {}) as {
      requireQualityCheck?: unknown;
      qualityProcessId?: unknown;
      qualityReports?: unknown;
    };
    const out: {
      requireQualityCheck?: boolean;
      qualityProcessId?: number | null;
      qualityReports?: boolean;
    } = {};
    if (v.qualityReports !== undefined) {
      if (typeof v.qualityReports !== "boolean") {
        return c.json({ error: "qualityReports must be a boolean." }, 400) as never;
      }
      out.qualityReports = v.qualityReports;
    }
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
    const [check, reports, steps, rows, members] = await Promise.all([
      qualityCheck(db, teamId),
      qualityReportsOn(db, teamId),
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
      qualityReports: reports,
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
  /**
   * Whether every part ends with quality control and which Quality Control step it is, and
   * whether those steps are finished with quality reports.
   */
  .put("/settings", requireAdmin, settingsValidator, async (c) => {
    const body = c.req.valid("json");
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const [before, reportsBefore] = await Promise.all([
      qualityCheck(db, teamId),
      qualityReportsOn(db, teamId),
    ]);
    const reports = body.qualityReports ?? reportsBefore;

    const next = {
      required: body.requireQualityCheck ?? before.required,
      processId: body.qualityProcessId === undefined ? before.processId : body.qualityProcessId,
    };

    const refused = await saveQualityCheck(db, teamId, next);
    if (refused) return c.json({ error: refused }, 400);
    if (reports !== reportsBefore) {
      await setSetting(db, teamId, SETTING.qualityReports, reports ? "1" : "");
    }

    const changed = changedFields(
      {
        requireQualityCheck: before.required,
        qualityProcessId: before.processId,
        qualityReports: reportsBefore,
      },
      {
        requireQualityCheck: next.required,
        qualityProcessId: next.processId,
        qualityReports: reports,
      },
    );
    if (changed.length > 0) {
      await logTeamChange(c.env, teamId, {
        userId: c.get("userId"),
        app: "shop",
        what: "Quality control",
        changed: settingLabels(manifest, changed),
      });
    }
    return c.json({
      requireQualityCheck: next.required,
      qualityProcessId: next.processId,
      qualityReports: reports,
    });
  });
