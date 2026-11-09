// SPDX-License-Identifier: AGPL-3.0-only
import { logTeamChange, requireAdmin, requireAuth } from "@g3/auth";
import { Hono } from "hono";
import type { AppEnv } from "./types";

/** Retained season data can be exported even when Scouting is switched off. */
export const seasonRoutes = new Hono<AppEnv>()
  .use("*", requireAuth, requireAdmin)
  .all("/scouting/*", async (c) => {
    const path = c.req.path.slice(
      c.req.path.indexOf("/seasons/scouting") + "/seasons/scouting".length,
    );
    const method = c.req.method;
    const allowed =
      (method === "GET" && /^\/?$|^\/exports(?:\/[a-zA-Z0-9-]+)?$/.test(path)) ||
      (method === "POST" && /^\/exports(?:\/[a-zA-Z0-9-]+\/\d+\/(archive|reset))?$/.test(path)) ||
      (method === "DELETE" && /^\/exports\/[a-zA-Z0-9-]+$/.test(path));
    if (!allowed) return c.json({ error: "Season action not found." }, 404);
    const url = new URL(
      `http://scouting/api/internal/teams/${encodeURIComponent(c.get("teamId"))}/seasons${path}`,
    );
    const year = c.req.query("year");
    if (year !== undefined) url.searchParams.set("year", year);
    try {
      const response = await c.env.SCOUTING.fetch(url.toString(), {
        method,
        headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: method === "POST" ? await c.req.text() : undefined,
      });
      if (response.ok && method === "POST" && /\/(archive|reset)$/.test(path)) {
        c.executionCtx.waitUntil(
          logTeamChange(c.env, c.get("teamId"), {
            userId: c.get("userId"),
            app: "scouting",
            what: path.endsWith("reset") ? "Season reset" : "Season export requested",
            changed: ["Season data"],
          }),
        );
      }
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return c.json(
        { error: "Couldn't reach Scouting. Try again; keep any archives you downloaded." },
        503,
      );
    }
  });
