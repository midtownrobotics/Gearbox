import { type PermissionApp, inTeam } from "@g3/auth";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { appPermissions } from "../db/schema";

export async function effectivePermissions(
  db: Db,
  user: { id: string; teamId: string; isAdmin: number; isMentor: number },
  app?: PermissionApp,
) {
  const grant =
    app && app !== "id"
      ? await db
          .select()
          .from(appPermissions)
          .where(
            inTeam(
              appPermissions,
              user.teamId,
              and(eq(appPermissions.userId, user.id), eq(appPermissions.app, app)),
            ),
          )
          .get()
      : undefined;
  return {
    isAdmin: grant ? grant.trustedStudent === 1 : user.isAdmin === 1,
    isMentor: grant ? grant.mentorAccess === 1 : user.isMentor === 1,
  };
}
