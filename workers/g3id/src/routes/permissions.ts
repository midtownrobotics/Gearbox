import {
  type PermissionCatalogApp,
  type PermissionGrant,
  type PermissionMember,
  inTeam,
  withTeam,
} from "@g3/auth";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { coreUsers, studentPermissions } from "../db/schema";
import { teamOfUser } from "../lib/team";
import { logToTeam } from "../lib/team-log";
import { requireAdmin } from "../middleware/auth";
import type { AppEnv } from "../types";

type Catalog = { apps: PermissionCatalogApp[]; grants: PermissionGrant[] };
export const permissionsRouter = new Hono<AppEnv>()
  .use("*", requireAdmin)
  .use("*", async (c, next) => {
    const teamId = await teamOfUser(createDb(c.env.DB), c.get("userId") as string);
    if (c.req.header("X-Team-Id") && c.req.header("X-Team-Id") !== teamId)
      return c.json({ error: "Another team's permissions." }, 403);
    c.set("adminTeamId", teamId);
    await next();
  })
  .get("/", async (c) => {
    const teamId = c.get("adminTeamId") as string;
    const db = createDb(c.env.DB);
    const platform = c.env.PLATFORM;
    if (!platform) return c.json({ error: "Platform is unavailable." }, 503);
    const res = await platform.fetch(
      new Request(`http://platform/api/internal/teams/${encodeURIComponent(teamId)}/permissions`, {
        headers: { Cookie: c.req.header("Cookie") ?? "", "X-Team-Id": teamId },
      }),
    );
    if (!res.ok)
      return c.json({ error: "Could not load your team's enabled app permissions." }, 502);
    const catalog = await res.json<Catalog>();
    const [users, rows] = await Promise.all([
      db
        .select()
        .from(coreUsers)
        .where(and(eq(coreUsers.teamId, teamId), eq(coreUsers.status, "active")))
        .orderBy(asc(coreUsers.displayName))
        .all(),
      db.select().from(studentPermissions).where(inTeam(studentPermissions, teamId)).all(),
    ]);
    const grants = [...catalog.grants, ...rows];
    const members: PermissionMember[] = users.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      isAdmin: user.isAdmin === 1,
      isMentor: user.isMentor === 1,
      permissions: Object.fromEntries(
        catalog.apps.map((app) => [
          app.slug,
          grants
            .filter((grant) => grant.userId === user.id && grant.app === app.slug)
            .map((grant) => grant.permission),
        ]),
      ),
    }));
    return c.json({ apps: catalog.apps, members, currentUserId: c.get("userId") });
  })
  .put("/:userId/roles", async (c) => {
    const body = await c.req.json<{ isAdmin?: unknown; isMentor?: unknown }>().catch(() => null);
    if (!body || typeof body.isAdmin !== "boolean" || typeof body.isMentor !== "boolean")
      return c.json({ error: "Choose Admin and Mentor roles." }, 400);
    const teamId = c.get("adminTeamId") as string;
    const userId = c.req.param("userId");
    const db = createDb(c.env.DB);
    const user = await db
      .select()
      .from(coreUsers)
      .where(
        and(eq(coreUsers.teamId, teamId), eq(coreUsers.id, userId), eq(coreUsers.status, "active")),
      )
      .get();
    if (!user) return c.json({ error: "Active member not found." }, 404);
    if (userId === c.get("userId") && !body.isAdmin)
      return c.json({ error: "You cannot remove your own Admin access." }, 400);
    await db
      .update(coreUsers)
      .set({
        isAdmin: Number(body.isAdmin),
        isMentor: Number(body.isMentor),
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(and(eq(coreUsers.teamId, teamId), eq(coreUsers.id, userId)));
    await logToTeam(c.env, teamId, {
      userId: c.get("userId") as string,
      app: "id",
      what: `Site-wide roles for ${user.displayName}`,
      changed: ["Admin", "Mentor"],
    });
    return c.json({ ok: true });
  })
  .put("/:userId/:app/:permission", async (c) => {
    const body = await c.req.json<{ enabled?: unknown }>().catch(() => null);
    if (!body || typeof body.enabled !== "boolean")
      return c.json({ error: "Choose whether to grant this permission." }, 400);
    const teamId = c.get("adminTeamId") as string;
    const { userId, app, permission } = c.req.param();
    const db = createDb(c.env.DB);
    const user = await db
      .select()
      .from(coreUsers)
      .where(
        and(eq(coreUsers.teamId, teamId), eq(coreUsers.id, userId), eq(coreUsers.status, "active")),
      )
      .get();
    if (!user) return c.json({ error: "Active member not found." }, 404);
    const headers = {
      Cookie: c.req.header("Cookie") ?? "",
      "X-Team-Id": teamId,
      "Content-Type": "application/json",
    };
    const platform = c.env.PLATFORM;
    if (!platform) return c.json({ error: "Platform is unavailable." }, 503);
    const catalogRes = await platform.fetch(
      new Request(
        `http://platform/api/internal/teams/${encodeURIComponent(teamId)}/permissions?grants=false`,
        { headers },
      ),
    );
    if (!catalogRes.ok) return c.json({ error: "Could not load enabled app permissions." }, 502);
    const catalog = await catalogRes.json<Catalog>();
    const definition = catalog.apps
      .find((item) => item.slug === app)
      ?.permissions.find((item) => item.key === permission);
    if (!definition) return c.json({ error: "Unknown or disabled app permission." }, 400);
    if (definition.storage === "app") {
      const res = await platform.fetch(
        new Request(
          `http://platform/api/internal/teams/${encodeURIComponent(teamId)}/permissions/${encodeURIComponent(app)}/${encodeURIComponent(userId)}/${encodeURIComponent(permission)}`,
          {
            method: "PUT",
            headers,
            body: JSON.stringify({ enabled: body.enabled, email: user.email }),
          },
        ),
      );
      if (!res.ok)
        return new Response(res.body, {
          status: res.status,
          headers: { "Content-Type": "application/json" },
        });
    } else if (body.enabled) {
      await db
        .insert(studentPermissions)
        .values(
          withTeam(teamId, {
            userId,
            app,
            permission,
            updatedAt: Math.floor(Date.now() / 1000),
            updatedBy: c.get("userId"),
          }),
        )
        .onConflictDoNothing();
    } else {
      await db
        .delete(studentPermissions)
        .where(
          inTeam(
            studentPermissions,
            teamId,
            and(
              eq(studentPermissions.userId, userId),
              eq(studentPermissions.app, app),
              eq(studentPermissions.permission, permission),
            ),
          ),
        );
    }
    await logToTeam(c.env, teamId, {
      userId: c.get("userId") as string,
      app,
      what: `Permission for ${user.displayName}`,
      changed: [definition.label],
    });
    return c.json({ ok: true });
  });
