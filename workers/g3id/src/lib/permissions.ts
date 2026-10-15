import { type PermissionApp, inTeam } from "@g3/auth";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { studentPermissions } from "../db/schema";
export async function assignedPermissions(
  db: Db,
  user: { id: string; teamId: string },
  app?: PermissionApp,
) {
  if (!app || app === "id" || app === "portal") return [];
  const grants = await db
    .select({ permission: studentPermissions.permission })
    .from(studentPermissions)
    .where(
      inTeam(
        studentPermissions,
        user.teamId,
        and(eq(studentPermissions.userId, user.id), eq(studentPermissions.app, app)),
      ),
    )
    .all();
  return grants.map((grant) => grant.permission);
}
