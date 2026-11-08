// SPDX-License-Identifier: AGPL-3.0-only
import { type StorageReport, requireAdmin, requireAuth } from "@g3/auth";
import { isStaging } from "@g3/site-config";
import { Hono } from "hono";
import { BINDINGS, MANIFESTS, STORING, inLibrary, isAppName } from "./registry";
import type { AppEnv } from "./types";

/** Retained files remain downloadable even when an app is switched off. */
export const storageRoutes = new Hono<AppEnv>()
  .use("*", requireAuth, requireAdmin)
  .get("/", async (c) => {
    const teamId = c.get("teamId");
    const cacheKey = new Request(
      `https://storage-counts.invalid/v1/${isStaging ? "staging" : "production"}/${encodeURIComponent(teamId)}`,
    );
    const cache = await caches.open("gearbox-team-storage-v1");
    const cached = await cache.match(cacheKey);
    if (cached)
      return new Response(cached.body, {
        headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
      });
    const apps = await Promise.all(
      STORING.filter((app) => inLibrary(app, teamId)).map(async (app) => {
        try {
          const binding = BINDINGS[app.slug];
          if (!binding) throw new Error("Unavailable");
          const response = await (c.env[binding] as Fetcher).fetch(
            `http://${app.slug}/api/internal/teams/${encodeURIComponent(teamId)}/storage`,
          );
          if (!response.ok) throw new Error("Unavailable");
          return {
            slug: app.slug,
            name: app.name,
            report: await response.json<StorageReport>(),
            error: null,
          };
        } catch {
          return {
            slug: app.slug,
            name: app.name,
            report: null,
            error: "Usage could not be checked. Try refreshing.",
          };
        }
      }),
    );
    const response = c.json({ apps });
    if (apps.every((app) => app.report)) {
      const cacheCopy = new Response(JSON.stringify({ apps }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      });
      c.executionCtx.waitUntil(cache.put(cacheKey, cacheCopy));
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  })
  .get("/:app/:kind", async (c) => {
    const app = c.req.param("app");
    const kind = c.req.param("kind");
    const teamId = c.get("teamId");
    if (
      !isAppName(app) ||
      !MANIFESTS[app].hooks.storage ||
      !inLibrary(MANIFESTS[app], teamId) ||
      !["download", "archive"].includes(kind)
    )
      return c.json({ error: "File not found." }, 404);
    const binding = BINDINGS[app];
    if (!binding) return c.json({ error: "Storage is unavailable." }, 503);
    const url = new URL(
      `http://${app}/api/internal/teams/${encodeURIComponent(teamId)}/storage/${kind}`,
    );
    // Forward only known parameters. The caller cannot choose another team's internal route.
    for (const key of ["key", "allowance", "eligible", "from", "to"]) {
      const value = c.req.query(key);
      if (value !== undefined) url.searchParams.set(key, value);
    }
    try {
      const response = await (c.env[binding] as Fetcher).fetch(url.toString());
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "private, no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return c.json({ error: "Couldn't download the files. Please try again." }, 503);
    }
  });
