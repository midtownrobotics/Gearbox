import { inTeam, teamSettingsRoutes } from "@g3/auth";
import { createEdgeDb } from "../db";
import { edgeStatus, netSettings } from "../db/schema";
import { writeAudit } from "../lib/audit";
import { teamBox } from "../lib/box-key";
import { manifest } from "../manifest";
import { getSettings } from "../modules/network/common";
import { bumpStateVersion, pokeAgent } from "../modules/network/control";
import type { AppEnv } from "../types";
import { OFFLINE_AFTER_SECONDS } from "./status";

// The team's Edge settings for the team's dashboard (roadmap 4.5), by manifest key: the data cap
// and billing day (the Network page's), and blocking and DNS hardening (Controls'). A change to
// either of the last two goes to the box like one made on Controls. The box's key is made on the
// Edge Box page; this only reports whether the box is connected.
export const teamSettingsRouter = teamSettingsRoutes<AppEnv>(manifest, "Edge settings", {
  async read(c) {
    const db = createEdgeDb(c.env.EDGE_DB);
    const teamId = c.get("teamId");
    const [settings, box, status] = await Promise.all([
      getSettings(db, teamId),
      teamBox(db, teamId),
      db.select().from(edgeStatus).where(inTeam(edgeStatus, teamId)).get(),
    ]);
    const online =
      status?.lastSeenAt !== undefined &&
      Math.floor(Date.now() / 1000) - status.lastSeenAt < OFFLINE_AFTER_SECONDS;
    return {
      values: {
        capBytes: settings.capBytes,
        cycleStartDay: settings.cycleStartDay,
        enforce: settings.enforce === 1,
        dnsHardening: settings.dnsHardening === 1,
      },
      secretsSet: { boxKey: box !== undefined },
      integrations: {
        "edge box": box
          ? {
              connected: online,
              detail: online ? undefined : "The box has a key but isn't online.",
            }
          : { connected: false },
      },
    };
  },
  async save(c, changes) {
    const db = createEdgeDb(c.env.EDGE_DB);
    const teamId = c.get("teamId");
    await getSettings(db, teamId);
    const flag = (v: unknown) => (v === undefined ? undefined : v ? 1 : 0);
    const toBox = changes.enforce !== undefined || changes.dnsHardening !== undefined;
    await db.batch([
      db
        .update(netSettings)
        .set({
          capBytes: changes.capBytes as number | undefined,
          cycleStartDay: changes.cycleStartDay as number | undefined,
          enforce: flag(changes.enforce),
          dnsHardening: flag(changes.dnsHardening),
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(inTeam(netSettings, teamId)),
      writeAudit(
        db,
        teamId,
        { id: c.get("userId"), displayName: c.get("userDisplayName") },
        "network.settings.update",
        changes,
      ),
      ...(toBox ? [bumpStateVersion(db, teamId)] : []),
    ]);
    if (toBox) c.executionCtx.waitUntil(pokeAgent(c.env, teamId));
  },
});
