import { type PermissionMember, inTeam, isPermissionApp, permissionApps, withTeam } from "@g3/auth";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { appPermissions, coreUsers } from "../db/schema";
import { teamOfUser } from "../lib/team";
import { logToTeam } from "../lib/team-log";
import { requireAdmin } from "../middleware/auth";
import type { AppEnv } from "../types";

/** The sole permission editor; app trusted students never gain access to this router. */
export const permissionsRouter = new Hono<AppEnv>()
  .use("*", requireAdmin)
  .use("*", async (c, next) => {
    const teamId = await teamOfUser(createDb(c.env.DB), c.get("userId") as string);
    if (c.req.header("X-Team-Id") && c.req.header("X-Team-Id") !== teamId)
      return c.json({ error: "This is another team's address." }, 403);
    c.set("adminTeamId", teamId);
    await next();
  })
  .get("/", async (c) => {
    const db = createDb(c.env.DB);
    const teamId = c.get("adminTeamId") as string;
    const [users, grants] = await Promise.all([
      db
        .select({
          id: coreUsers.id,
          displayName: coreUsers.displayName,
          email: coreUsers.email,
          isAdmin: coreUsers.isAdmin,
          isMentor: coreUsers.isMentor,
        })
        .from(coreUsers)
        .where(and(eq(coreUsers.teamId, teamId), eq(coreUsers.status, "active")))
        .orderBy(asc(coreUsers.displayName))
        .all(),
      db.select().from(appPermissions).where(inTeam(appPermissions, teamId)).all(),
    ]);
    const byMember = new Map(grants.map((grant) => [`${grant.userId}:${grant.app}`, grant]));
    const members: PermissionMember[] = users.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      permissions: Object.fromEntries(
        permissionApps.map((app) => {
          const grant = byMember.get(`${user.id}:${app.slug}`);
          return [
            app.slug,
            {
              trustedStudent: grant ? grant.trustedStudent === 1 : user.isAdmin === 1,
              mentorAccess: grant ? grant.mentorAccess === 1 : user.isMentor === 1,
              inherited: app.slug !== "id" && !grant,
            },
          ];
        }),
      ) as PermissionMember["permissions"],
    }));
    return c.json({ apps: permissionApps, members, currentUserId: c.get("userId") });
  })
  .put("/:userId/:app", async (c) => {
    const app = c.req.param("app");
    if (!isPermissionApp(app)) return c.json({ error: "Unknown app." }, 400);
    const body = await c.req
      .json<{ trustedStudent?: unknown; mentorAccess?: unknown }>()
      .catch(() => null);
    if (!body || typeof body.trustedStudent !== "boolean" || typeof body.mentorAccess !== "boolean")
      return c.json({ error: "Choose trusted student and mentor access." }, 400);
    const definition = permissionApps.find((item) => item.slug === app);
    if (!definition?.mentor && body.mentorAccess)
      return c.json({ error: "This app does not have a mentor permission." }, 400);
    const db = createDb(c.env.DB);
    const teamId = c.get("adminTeamId") as string;
    const userId = c.req.param("userId");
    const user = await db
      .select()
      .from(coreUsers)
      .where(
        and(eq(coreUsers.teamId, teamId), eq(coreUsers.id, userId), eq(coreUsers.status, "active")),
      )
      .get();
    if (!user) return c.json({ error: "Active member not found." }, 404);
    if (app === "id" && userId === c.get("userId") && !body.trustedStudent)
      return c.json({ error: "You cannot remove your own ID trusted student access." }, 400);
    const now = Math.floor(Date.now() / 1000);
    if (app === "id") {
      await db
        .update(coreUsers)
        .set({
          isAdmin: Number(body.trustedStudent),
          isMentor: Number(body.mentorAccess),
          updatedAt: now,
        })
        .where(and(eq(coreUsers.teamId, teamId), eq(coreUsers.id, userId)));
    } else {
      const values = {
        trustedStudent: Number(body.trustedStudent),
        mentorAccess: Number(body.mentorAccess),
        updatedAt: now,
        updatedBy: c.get("userId"),
      };
      await db
        .insert(appPermissions)
        .values(withTeam(teamId, { userId, app, ...values }))
        .onConflictDoUpdate({
          target: [appPermissions.teamId, appPermissions.userId, appPermissions.app],
          set: values,
        });
    }
    await logToTeam(c.env, teamId, {
      userId: c.get("userId") as string,
      app: "id",
      what: `${definition?.label} permissions for ${user.displayName}`,
      changed: ["Trusted student", "Mentor access"],
    });
    return c.json({ ok: true });
  })
  .delete("/:userId/:app", async (c) => {
    const app = c.req.param("app");
    if (!isPermissionApp(app) || app === "id")
      return c.json({ error: "Choose an app permission to reset." }, 400);
    const db = createDb(c.env.DB);
    const teamId = c.get("adminTeamId") as string;
    const userId = c.req.param("userId");
    const user = await db
      .select({ id: coreUsers.id, displayName: coreUsers.displayName })
      .from(coreUsers)
      .where(and(eq(coreUsers.teamId, teamId), eq(coreUsers.id, userId)))
      .get();
    if (!user) return c.json({ error: "Member not found." }, 404);
    await db
      .delete(appPermissions)
      .where(
        inTeam(
          appPermissions,
          teamId,
          and(eq(appPermissions.userId, userId), eq(appPermissions.app, app)),
        ),
      );
    await logToTeam(c.env, teamId, {
      userId: c.get("userId") as string,
      app: "id",
      what: `${app} permissions for ${user.displayName}`,
      changed: ["Use ID roles"],
    });
    return c.json({ ok: true });
  });
