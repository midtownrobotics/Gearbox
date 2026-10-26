import { requireAdmin, requireAuth } from "@g3/auth";
import { Hono } from "hono";
import { createShopDb } from "../db";
import { ONSHAPE_CALLS, onshapeFetch, onshapeProblem, usageReport } from "../lib/onshape-api";
import { onshapeConfig } from "../lib/onshape-config";
import type { AppEnv } from "../types";

// How the team's Onshape connection is doing: the banner every page shows under the bar while it
// isn't working (`/onshape/status`), and the Admin page's API usage (`/admin/onshape/usage`), with a
// button to try the keys again (`/admin/onshape/check`).
export const onshapeUsageRouter = new Hono<AppEnv>()
  .get("/onshape/status", requireAuth, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const config = await onshapeConfig(c.env, db, teamId).catch(() => null);
    const problem = config?.credentials
      ? await onshapeProblem(db, teamId, config.credentials)
      : null;
    return c.json({
      hasApiKey: Boolean(config?.credentials),
      problem: problem && { ...problem, label: ONSHAPE_CALLS[problem.kind] ?? problem.kind },
    });
  })
  // `?keys=all` counts every key the team has used; otherwise only the current keys.
  .get("/admin/onshape/usage", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const { credentials } = await onshapeConfig(c.env, db, teamId);
    const onlyCurrent = c.req.query("keys") !== "all";
    return c.json(await usageReport(db, teamId, credentials, onlyCurrent));
  })
  // One light call with the team's keys (who they belong to), counted like any other.
  .post("/admin/onshape/check", requireAdmin, async (c) => {
    const db = createShopDb(c.env.SHOP_DB);
    const teamId = c.get("teamId");
    const { credentials } = await onshapeConfig(c.env, db, teamId);
    if (!credentials) return c.json({ error: "Add Onshape API keys first." }, 400);
    try {
      const res = await onshapeFetch(
        { db, teamId, credentials },
        "connection_check",
        "/users/sessioninfo",
      );
      return c.json({ ok: res.ok, status: res.status });
    } catch {
      return c.json({ ok: false, status: 0 });
    }
  });
