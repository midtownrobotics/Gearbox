import { type ReportData, type ReportSession, buildReport } from "../leaderboard/attendance-report";

// One member's own figures for the school year, from the same report the Leaderboard draws.
// Meeting days are the days anyone signed in, in the viewer's own time zone.

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type MySummary = {
  year: string;
  totalHours: number;
  /** Their place by hours among everyone on the Leaderboard (1 is most), and how many there are. */
  rank: number;
  of: number;
  /** The Leaderboard's average hours per person. */
  teamAverageHours: number;
  attended: number;
  meetingDays: number;
  /** Hours per meeting day they came to (sign-ins only; an admin's adjustments are left out). */
  hoursPerMeeting: number;
  /** Meeting days in a row they came to, up to the latest (today's doesn't break it before they arrive). */
  streak: number;
  hoursLast30Days: number;
  missedSignOuts: number;
  /** When this visit began, if they're signed in now. */
  signedInSince: Date | null;
  /** Every sign-in and adjustment, newest first. */
  visits: ReportSession[];
};

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** The signed-in member's summary, or null when they haven't signed in this school year. */
export function mySummary(data: ReportData, userId: string, now = new Date()): MySummary | null {
  const index = data.members.findIndex((member) => member.id === userId);
  if (index < 0) return null;
  const report = buildReport(data, () => true);
  const rows = report.rows;
  const mine = rows.find((row) => row.member.id === userId);
  if (!mine) return null;

  const sessions = data.sessions.filter((s) => s.member === index);
  const visits = sessions.filter((s) => s.kind !== "adjustment");
  const visitMs = visits.reduce((sum, s) => sum + Math.max(0, s.ms), 0);

  // Back from the latest meeting day; today's only counts once they've come.
  let streak = 0;
  for (let i = report.days.length - 1; i >= 0; i--) {
    if (mine.cells[i]) streak++;
    else if (i === report.days.length - 1 && sameDay(report.days[i].date, now)) continue;
    else break;
  }

  const open = visits.filter((s) => s.kind === "open").pop();
  return {
    year: data.year,
    totalHours: mine.totalHours,
    rank: rows.filter((row) => row.totalHours > mine.totalHours).length + 1,
    of: rows.length,
    teamAverageHours: rows.reduce((sum, row) => sum + row.totalHours, 0) / rows.length,
    attended: mine.attended,
    meetingDays: report.days.length,
    hoursPerMeeting: mine.attended ? visitMs / HOUR / mine.attended : 0,
    streak,
    hoursLast30Days:
      visits
        .filter((s) => s.signIn >= now.getTime() - 30 * DAY)
        .reduce((sum, s) => sum + Math.max(0, s.ms), 0) / HOUR,
    missedSignOuts: visits.filter((s) => s.kind === "missed").length,
    signedInSince: open ? new Date(open.signIn) : null,
    visits: [...sessions].reverse(),
  };
}

/** "1st", "2nd", "13th" */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
