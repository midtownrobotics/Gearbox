import { inTeam, withTeam } from "@g3/auth";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  attendanceMembers,
  attendanceSessions,
  attendanceSettings,
  attendanceTotals,
} from "./db/schema";
import { type AttendanceSettings, DEFAULT_SETTINGS } from "./settings";

export type Member = typeof attendanceMembers.$inferSelect;
export type Session = typeof attendanceSessions.$inferSelect;

/** One team's attendance records: every query here is kept to that team. */
export class AttendanceDb {
  private readonly db;

  constructor(
    d1: D1Database,
    readonly teamId: string,
  ) {
    this.db = drizzle(d1);
  }

  listMembers(): Promise<Member[]> {
    return this.db
      .select()
      .from(attendanceMembers)
      .where(inTeam(attendanceMembers, this.teamId))
      .all();
  }

  async getMember(id: string): Promise<Member | null> {
    const row = await this.db
      .select()
      .from(attendanceMembers)
      .where(inTeam(attendanceMembers, this.teamId, eq(attendanceMembers.id, id)))
      .get();
    return row ?? null;
  }

  async upsertMember(member: Omit<Member, "teamId">): Promise<void> {
    await this.db
      .insert(attendanceMembers)
      .values(withTeam(this.teamId, member))
      .onConflictDoUpdate({
        target: attendanceMembers.id,
        set: { userId: member.userId, displayName: member.displayName, email: member.email },
        // A member id belongs to one team; never move another team's row.
        setWhere: inTeam(attendanceMembers, this.teamId),
      });
  }

  listSessions(memberId?: string): Promise<Session[]> {
    return this.db
      .select()
      .from(attendanceSessions)
      .where(
        inTeam(
          attendanceSessions,
          this.teamId,
          memberId ? eq(attendanceSessions.memberId, memberId) : undefined,
        ),
      )
      .all();
  }

  listOpenSessions(memberId?: string): Promise<Session[]> {
    return this.db
      .select()
      .from(attendanceSessions)
      .where(
        inTeam(
          attendanceSessions,
          this.teamId,
          eq(attendanceSessions.status, "open"),
          memberId ? eq(attendanceSessions.memberId, memberId) : undefined,
        ),
      )
      .all();
  }

  async addSession(session: Omit<Session, "id" | "teamId"> & { id?: string }): Promise<string> {
    const id = session.id ?? crypto.randomUUID();
    await this.db.insert(attendanceSessions).values(withTeam(this.teamId, { ...session, id }));
    return id;
  }

  async closeSession(id: string, signOut: number, durationMs: number, status: Session["status"]) {
    await this.db
      .update(attendanceSessions)
      .set({ signOut, durationMs, status })
      .where(inTeam(attendanceSessions, this.teamId, eq(attendanceSessions.id, id)));
  }

  async setTotal(memberId: string, year: string, totalMs: number, sessions: number) {
    const values = { totalMs, totalHours: totalMs / 3_600_000, sessions };
    await this.db
      .insert(attendanceTotals)
      .values(withTeam(this.teamId, { memberId, schoolYear: year, ...values }))
      .onConflictDoUpdate({
        target: [attendanceTotals.memberId, attendanceTotals.schoolYear],
        set: values,
        setWhere: inTeam(attendanceTotals, this.teamId),
      });
  }

  async deleteMember(id: string): Promise<void> {
    await this.db
      .delete(attendanceMembers)
      .where(inTeam(attendanceMembers, this.teamId, eq(attendanceMembers.id, id)));
  }

  async settings(): Promise<AttendanceSettings> {
    const row = await this.db
      .select({
        schoolYearStartMonth: attendanceSettings.schoolYearStartMonth,
        schoolYearStartDay: attendanceSettings.schoolYearStartDay,
        autoSignOutHours: attendanceSettings.autoSignOutHours,
      })
      .from(attendanceSettings)
      .where(inTeam(attendanceSettings, this.teamId))
      .get();
    return row ?? DEFAULT_SETTINGS;
  }

  async saveSettings(settings: AttendanceSettings, updatedBy: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db
      .insert(attendanceSettings)
      .values(withTeam(this.teamId, { ...settings, updatedAt: now, updatedBy }))
      .onConflictDoUpdate({
        target: attendanceSettings.teamId,
        set: { ...settings, updatedAt: now, updatedBy },
        setWhere: inTeam(attendanceSettings, this.teamId),
      });
  }
}

/**
 * The teams with a session still open, for the auto sign-out cron, which then works team by
 * team with each team's own limit.
 */
export async function teamsWithOpenSessions(d1: D1Database): Promise<string[]> {
  // tenancy: all teams (the cron finds which teams to close sessions for, then scopes to each)
  const rows = await drizzle(d1)
    .selectDistinct({ teamId: attendanceSessions.teamId })
    .from(attendanceSessions)
    .where(eq(attendanceSessions.status, "open"))
    .all();
  return rows.map((row) => row.teamId);
}
