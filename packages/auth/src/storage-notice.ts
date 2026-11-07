// SPDX-License-Identifier: AGPL-3.0-only
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { logTeamChange } from "./audit";
import { activeMembers, sendMemberDM } from "./members";

const notices = sqliteTable("storage_cleanup_notices", {
  teamId: text("team_id").primaryKey(),
  files: integer("files").notNull(),
  bytes: integer("bytes").notNull(),
  oldest: integer("oldest").notNull(),
  newest: integer("newest").notNull(),
  lastSentAt: integer("last_sent_at").notNull(),
});

export async function clearStorageCleanupNotice(database: D1Database, teamId: string) {
  await drizzle(database).delete(notices).where(eq(notices.teamId, teamId));
}

/** No filenames or member data leave the app: only totals and upload dates, to its own admins. */
export async function notifyStorageCleanup(
  env: { G3ID: Fetcher },
  teamId: string,
  app: string,
  files: { size: number; uploaded: Date }[],
  database: D1Database,
) {
  if (!files.length) return;
  try {
    const db = drizzle(database);
    const prior = await db.select().from(notices).where(eq(notices.teamId, teamId)).get();
    const bytes = files.reduce((sum, file) => sum + file.size, 0);
    const times = files.map((file) => file.uploaded.getTime()).filter(Number.isFinite);
    const oldest = Math.min(
      times.length ? Math.min(...times) : Date.now(),
      prior?.files ? prior.oldest : Number.POSITIVE_INFINITY,
    );
    const newest = Math.max(
      times.length ? Math.max(...times) : Date.now(),
      prior?.files ? prior.newest : Number.NEGATIVE_INFINITY,
    );
    const pending = {
      files: (prior?.files ?? 0) + files.length,
      bytes: (prior?.bytes ?? 0) + bytes,
      oldest,
      newest,
      lastSentAt: prior?.lastSentAt ?? 0,
    };
    await db
      .insert(notices)
      .values({ teamId, ...pending })
      .onConflictDoUpdate({ target: notices.teamId, set: pending });
    // The first cleanup is reported immediately; later ones are accumulated until another
    // cleanup occurs at least an hour later. This avoids a DM for every new image at capacity.
    if (prior?.lastSentAt && Date.now() - prior.lastSentAt < 60 * 60_000) return;
    const days = (time: number) => Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
    const size =
      pending.bytes >= 1024 ** 3
        ? `${(pending.bytes / 1024 ** 3).toFixed(2)} GB`
        : pending.bytes >= 1024 ** 2
          ? `${(pending.bytes / 1024 ** 2).toFixed(1)} MB`
          : `${Math.ceil(pending.bytes / 1024)} KB`;
    const date = (time: number) => new Date(time).toISOString().slice(0, 10);
    const summary = `Removed ${pending.files} oldest files (${size}), uploaded ${date(oldest)} to ${date(newest)} (${days(newest)}–${days(oldest)} days ago), to stay within the storage cap.`;
    await logTeamChange(env, teamId, {
      userId: null,
      app,
      what: "Automatic storage cleanup",
      changed: [summary],
    });
    await db
      .update(notices)
      .set({ files: 0, bytes: 0, lastSentAt: Date.now() })
      .where(eq(notices.teamId, teamId));
    const admins = (await activeMembers(env, teamId))?.filter((member) => member.isAdmin) ?? [];
    for (let offset = 0; offset < admins.length; offset += 100) {
      await sendMemberDM(
        env,
        teamId,
        admins.slice(offset, offset + 100).map((admin) => admin.id),
        `${app === "shop" ? "Shop" : app === "pit" ? "Pit" : "Scouting"} storage cleanup: ${summary} This deletion is permanent. Download files you want to keep before the cap is reached.`,
      );
    }
  } catch (error) {
    console.error("[storage] admin notice failed", error);
  }
}
