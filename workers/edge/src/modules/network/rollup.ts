import { inTeam } from "@g3/auth";
import { lt, sql, sum } from "drizzle-orm";
import type { EdgeDb } from "../../db";
import { netUsage, netUsageHourly } from "../../db/schema";
import { DAY, HOUR } from "../../lib/time";

/** Raw 5-minute rows are kept this long before being rolled up into hourly rows. */
export const RAW_RETENTION_SECONDS = 14 * DAY;

/**
 * Moves the team's raw rows older than the retention window into net_usage_hourly, in one atomic
 * batch. The cutoff is hour-aligned so no hour is split across tables.
 */
export async function rollupUsage(db: EdgeDb, teamId: string, now = Math.floor(Date.now() / 1000)) {
  const cutoff = Math.floor((now - RAW_RETENTION_SECONDS) / HOUR) * HOUR;
  // Constants written into the SQL: bound, D1 sends them as reals and the division wouldn't floor.
  const hour = sql<number>`(${netUsage.ts} / ${sql.raw(String(HOUR))}) * ${sql.raw(String(HOUR))}`;
  const [inserted] = await db.batch([
    // Copied from the team's own rows (inTeam), team and all.
    db
      .insert(netUsageHourly)
      .select(
        db
          .select({
            teamId: netUsage.teamId,
            mac: netUsage.mac,
            ts: hour.as("ts"),
            dlBytes: sum(netUsage.dlBytes).mapWith(Number).as("dl_bytes"),
            ulBytes: sum(netUsage.ulBytes).mapWith(Number).as("ul_bytes"),
          })
          .from(netUsage)
          .where(inTeam(netUsage, teamId, lt(netUsage.ts, cutoff)))
          .groupBy(netUsage.mac, hour),
      )
      .onConflictDoUpdate({
        target: [netUsageHourly.teamId, netUsageHourly.ts, netUsageHourly.mac],
        set: {
          dlBytes: sql`${netUsageHourly.dlBytes} + excluded.dl_bytes`,
          ulBytes: sql`${netUsageHourly.ulBytes} + excluded.ul_bytes`,
        },
      }),
    db.delete(netUsage).where(inTeam(netUsage, teamId, lt(netUsage.ts, cutoff))),
  ]);
  console.log("[Rollup] Rolled up usage", { teamId, cutoff, inserted });
}
