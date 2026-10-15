import { type PermissionGrant, forwardIdentity, requireAdmin } from "@g3/auth";
import { Hono, type MiddlewareHandler } from "hono";
import { db } from "./lib";
import { MANIFESTS } from "./registry";
import { enabledApps } from "./team";
import type { AppEnv } from "./types";

/** Identity owns student grants; Platform supplies enabled manifests and preserves app-owned grants. */
const ownTeam: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.param("teamId") !== c.get("teamId"))
    return c.json({ error: "Another team's permissions." }, 403);
  await next();
};
export const permissionsRouter = new Hono<AppEnv>()
  .use("/:teamId/permissions", requireAdmin, ownTeam)
  .use("/:teamId/permissions/*", requireAdmin, ownTeam)
  .get("/:teamId/permissions", async (c) => {
    const on = await enabledApps(db(c.env), c.get("teamId"));
    const apps = on
      .map((slug) => MANIFESTS[slug])
      .filter((app) => app.permissions.length)
      .map(({ slug, name, permissions }) => ({ slug, name, permissions }));
    const grants: PermissionGrant[] = [];
    if (c.req.query("grants") !== "false") {
      if (on.includes("orders")) {
        const res = await c.env.ORDERS.fetch(
          new Request("http://orders/api/trusted", { headers: forwardIdentity(c) }),
        );
        if (!res.ok) return c.json({ error: "Could not load Orders permissions." }, 502);
        const rows = await res.json<{ id: string; trusted: boolean }[]>();
        grants.push(
          ...rows
            .filter((row) => row.trusted)
            .map((row) => ({ userId: row.id, app: "orders" as const, permission: "catalog" })),
        );
      }
      if (on.includes("scouting")) {
        const res = await c.env.SCOUTING.fetch(
          new Request("http://scouting/api/scouting/permission-management", {
            headers: forwardIdentity(c),
          }),
        );
        if (!res.ok) return c.json({ error: "Could not load Scouting permissions." }, 502);
        const data = await res.json<{
          leads: { userId: string }[];
          publishers: { email: string }[];
          helpers: { userId: string }[];
        }>();
        const membersRes = await c.env.G3ID.fetch(
          new Request(
            `http://g3id/api/internal/teams/${encodeURIComponent(c.get("teamId"))}/members`,
          ),
        );
        if (!membersRes.ok) return c.json({ error: "Could not load members." }, 502);
        const members = await membersRes.json<{ id: string; email: string }[]>();
        for (const [permission, rows] of [
          ["strategy", data.leads],
          ["service", data.helpers],
        ] as const)
          grants.push(
            ...rows.map((row) => ({ userId: row.userId, app: "scouting" as const, permission })),
          );
        for (const publisher of data.publishers) {
          const member = members.find(
            (person) => person.email.toLowerCase() === publisher.email.toLowerCase(),
          );
          if (member) grants.push({ userId: member.id, app: "scouting", permission: "publish" });
        }
      }
    }
    return c.json({ apps, grants });
  })
  .put("/:teamId/permissions/:app/:userId/:permission", async (c) => {
    const { app, userId, permission } = c.req.param();
    const on = await enabledApps(db(c.env), c.get("teamId"));
    const manifest = on.map((slug) => MANIFESTS[slug]).find((item) => item.slug === app);
    if (!manifest?.permissions.some((item) => item.key === permission && item.storage === "app"))
      return c.json({ error: "Unknown or disabled app permission." }, 400);
    const body = await c.req.json<{ enabled: boolean; email: string }>();
    if (typeof body.enabled !== "boolean" || typeof body.email !== "string")
      return c.json({ error: "Invalid permission." }, 400);
    let url: string;
    let method: string;
    let data: unknown;
    if (app === "orders" && permission === "catalog") {
      url = `http://orders/api/trusted/${encodeURIComponent(userId)}`;
      method = "PUT";
      data = { trusted: body.enabled };
    } else if (app === "scouting" && ["strategy", "publish", "service"].includes(permission)) {
      if (permission === "service" && body.enabled) {
        const existing = await c.env.SCOUTING.fetch(
          new Request("http://scouting/api/scouting/permission-management", {
            headers: forwardIdentity(c),
          }),
        );
        if (!existing.ok) return c.json({ error: "Could not load service crew permissions." }, 502);
        const current = await existing.json<{ helpers: { userId: string }[] }>();
        // Regranting access must not reset the crew member's existing skills.
        if (current.helpers.some((helper) => helper.userId === userId)) return c.json({ ok: true });
      }
      const route =
        permission === "strategy"
          ? "strategy-admins"
          : permission === "publish"
            ? "field-map-publishers"
            : "service-helpers";
      url = `http://scouting/api/scouting/${route}${body.enabled ? "" : `/${encodeURIComponent(permission === "publish" ? body.email : userId)}`}`;
      method = body.enabled ? "POST" : "DELETE";
      if (body.enabled) data = { userId, ...(permission === "service" ? { skills: [] } : {}) };
    } else return c.json({ error: "Unknown app permission provider." }, 400);
    const res = await (app === "orders" ? c.env.ORDERS : c.env.SCOUTING).fetch(
      new Request(url, {
        method,
        headers: { ...forwardIdentity(c), "Content-Type": "application/json" },
        ...(data ? { body: JSON.stringify(data) } : {}),
      }),
    );
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  });
