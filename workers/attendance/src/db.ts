export type Member = {
  id: string;
  userId: string;
  displayName: string;
  email: string;
};

export type Session = {
  id: string;
  memberId: string;
  signIn: number;
  signOut: number | null;
  durationMs: number | null;
  adjustmentMs: number | null;
  status: "open" | "completed" | "auto-closed" | "manual-adjustment";
  year: string;
  addedBy: string | null;
};

type MemberRow = { id: string; user_id: string; display_name: string; email: string };
type SessionRow = {
  id: string;
  member_id: string;
  sign_in: number;
  sign_out: number | null;
  duration_ms: number | null;
  adjustment_ms: number | null;
  status: Session["status"];
  school_year: string;
  added_by: string | null;
};

const memberFromRow = (row: MemberRow): Member => ({
  id: row.id,
  userId: row.user_id,
  displayName: row.display_name,
  email: row.email,
});

const sessionFromRow = (row: SessionRow): Session => ({
  id: row.id,
  memberId: row.member_id,
  signIn: row.sign_in,
  signOut: row.sign_out,
  durationMs: row.duration_ms,
  adjustmentMs: row.adjustment_ms,
  status: row.status,
  year: row.school_year,
  addedBy: row.added_by,
});

const SESSION_COLUMNS =
  "id, member_id, sign_in, sign_out, duration_ms, adjustment_ms, status, school_year, added_by";

export class AttendanceDb {
  constructor(private readonly d1: D1Database) {}

  async listMembers(): Promise<Member[]> {
    const result = await this.d1
      .prepare("SELECT id, user_id, display_name, email FROM attendance_members")
      .all<MemberRow>();
    return result.results.map(memberFromRow);
  }

  async getMember(id: string): Promise<Member | null> {
    const row = await this.d1
      .prepare("SELECT id, user_id, display_name, email FROM attendance_members WHERE id = ?")
      .bind(id)
      .first<MemberRow>();
    return row ? memberFromRow(row) : null;
  }

  async upsertMember(member: Member): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO attendance_members (id, user_id, display_name, email)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id,
           display_name = excluded.display_name, email = excluded.email`,
      )
      .bind(member.id, member.userId, member.displayName, member.email)
      .run();
  }

  async listSessions(memberId?: string): Promise<Session[]> {
    const statement = memberId
      ? this.d1
          .prepare(`SELECT ${SESSION_COLUMNS} FROM attendance_sessions WHERE member_id = ?`)
          .bind(memberId)
      : this.d1.prepare(`SELECT ${SESSION_COLUMNS} FROM attendance_sessions`);
    const result = await statement.all<SessionRow>();
    return result.results.map(sessionFromRow);
  }

  async listOpenSessions(memberId?: string): Promise<Session[]> {
    const statement = memberId
      ? this.d1
          .prepare(
            `SELECT ${SESSION_COLUMNS} FROM attendance_sessions
             WHERE status = 'open' AND member_id = ?`,
          )
          .bind(memberId)
      : this.d1.prepare(`SELECT ${SESSION_COLUMNS} FROM attendance_sessions WHERE status = 'open'`);
    const result = await statement.all<SessionRow>();
    return result.results.map(sessionFromRow);
  }

  async addSession(session: Omit<Session, "id"> & { id?: string }): Promise<string> {
    const id = session.id ?? crypto.randomUUID();
    await this.d1
      .prepare(
        `INSERT INTO attendance_sessions
           (id, member_id, sign_in, sign_out, duration_ms, adjustment_ms, status, school_year, added_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        session.memberId,
        session.signIn,
        session.signOut,
        session.durationMs,
        session.adjustmentMs,
        session.status,
        session.year,
        session.addedBy,
      )
      .run();
    return id;
  }

  async closeSession(id: string, signOut: number, durationMs: number, status: Session["status"]) {
    await this.d1
      .prepare(
        "UPDATE attendance_sessions SET sign_out = ?, duration_ms = ?, status = ? WHERE id = ?",
      )
      .bind(signOut, durationMs, status, id)
      .run();
  }

  async setTotal(memberId: string, year: string, totalMs: number, sessions: number) {
    await this.d1
      .prepare(
        `INSERT INTO attendance_totals (member_id, school_year, total_ms, total_hours, sessions)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(member_id, school_year) DO UPDATE SET total_ms = excluded.total_ms,
           total_hours = excluded.total_hours, sessions = excluded.sessions`,
      )
      .bind(memberId, year, totalMs, totalMs / 3_600_000, sessions)
      .run();
  }

  async deleteMember(id: string): Promise<void> {
    await this.d1.prepare("DELETE FROM attendance_members WHERE id = ?").bind(id).run();
  }
}
