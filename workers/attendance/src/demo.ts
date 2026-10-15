import { DEMO_PEOPLE, vocabularyOf } from "@g3/demo";
import { AttendanceDb, type Session, memberKey } from "./db";
import { schoolYear } from "./settings";

// The public demo's attendance (roadmap 5.3), loaded after its nightly reset: six weeks of
// meetings three days a week, most of the team at each, one missed sign-out, one adjustment, and
// two people signed in now.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Meeting days: Monday, Wednesday and Saturday. */
const MEETING_DAYS = new Set([1, 3, 6]);

export async function loadDemo(d1: D1Database, teamId: string) {
  const store = new AttendanceDb(d1, teamId);
  const settings = await store.settings();
  const now = Date.now();
  const sessions: (Omit<Session, "id" | "teamId"> & { id: string })[] = [];
  const totals = new Map<string, { year: string; ms: number; count: number }>();
  const add = (memberId: string, session: Omit<Session, "id" | "teamId" | "memberId">) => {
    sessions.push({ ...session, memberId, id: crypto.randomUUID() });
    if (session.status === "open") return;
    const total = totals.get(memberId) ?? { year: session.schoolYear, ms: 0, count: 0 };
    total.ms += session.adjustmentMs ?? session.durationMs ?? 0;
    total.count++;
    totals.set(memberId, total);
  };

  const members = DEMO_PEOPLE.map((person) => ({
    id: memberKey(person.name, person.id),
    userId: person.id,
    displayName: person.name,
    email: person.email,
  }));
  for (const member of members) await store.upsertMember(member);

  for (let daysAgo = 42; daysAgo >= 1; daysAgo--) {
    const start = new Date(now - daysAgo * DAY);
    if (!MEETING_DAYS.has(start.getUTCDay())) continue;
    // 6 PM Eastern on weekdays, 1 PM on Saturdays (in UTC, close enough all year).
    start.setUTCHours(start.getUTCDay() === 6 ? 17 : 22, 0, 0, 0);
    for (const [i, member] of members.entries()) {
      // Most come to most meetings; who misses one changes from day to day.
      if ((i * 7 + daysAgo * 3) % 10 >= 8) continue;
      const signIn = start.getTime() + ((i * 13) % 30) * 60_000;
      const year = schoolYear(new Date(signIn), settings);
      if ((i + daysAgo) % 23 === 0) {
        // Forgot to sign out: closed at the limit, and doesn't count.
        add(member.id, {
          signIn,
          signOut: signIn + settings.autoSignOutHours * HOUR,
          durationMs: 0,
          adjustmentMs: null,
          status: "auto-closed",
          schoolYear: year,
          addedBy: null,
        });
        continue;
      }
      const durationMs = (2 + ((i + daysAgo) % 3)) * HOUR - ((i * 11) % 45) * 60_000;
      add(member.id, {
        signIn,
        signOut: signIn + durationMs,
        durationMs,
        adjustmentMs: null,
        status: "completed",
        schoolYear: year,
        addedBy: null,
      });
    }
  }

  const first = members[0];
  const mentor = members[1];
  if (first && mentor) {
    add(first.id, {
      signIn: now - 10 * DAY,
      signOut: now - 10 * DAY,
      durationMs: null,
      adjustmentMs: 2 * HOUR,
      status: "manual-adjustment",
      schoolYear: schoolYear(new Date(now - 10 * DAY), settings),
      addedBy: mentor.userId,
    });
  }
  for (const member of members.slice(3, 5)) {
    add(member.id, {
      signIn: now - HOUR,
      signOut: null,
      durationMs: null,
      adjustmentMs: null,
      status: "open",
      schoolYear: schoolYear(new Date(now - HOUR), settings),
      addedBy: null,
    });
  }

  for (const session of sessions) await store.addSession(session);
  for (const [memberId, total] of totals) {
    await store.setTotal(memberId, total.year, total.ms, total.count);
  }
  return { sessions: sessions.length };
}

/** The words in the demo's attendance (its members' names), for the gateway. */
export const demoWords = (): string[] => vocabularyOf(DEMO_PEOPLE);
