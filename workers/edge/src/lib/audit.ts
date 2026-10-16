import { withTeam } from "@g3/auth";
import type { EdgeDb } from "../db";
import { edgeAudit } from "../db/schema";

export function writeAudit(
  db: EdgeDb,
  teamId: string,
  user: { id: string; displayName: string },
  action: string,
  detail: Record<string, unknown>,
) {
  return db.insert(edgeAudit).values(
    withTeam(teamId, {
      userId: user.id,
      userDisplayName: user.displayName,
      action,
      detail: JSON.stringify(detail),
      createdAt: Math.floor(Date.now() / 1000),
    }),
  );
}
