// Shapes the attendance worker's report (every sign-in of the school year, with what it counted
// for) into what the Leaderboard page's reports draw. Days are the viewer's own: a team has no time zone.

export type ReportMember = { id: string; displayName: string; isMentor: boolean };

export type ReportSession = {
  /** Index into the report's members. */
  member: number;
  signIn: number;
  /** A missed sign-out counts for no time; an adjustment is an admin's change to hours. */
  kind: "completed" | "open" | "missed" | "adjustment";
  /** The time it counted for. An adjustment's can be negative. */
  ms: number;
};

export type ReportData = { year: string; members: ReportMember[]; sessions: ReportSession[] };

/** What one member did on one meeting day. */
export type DayCell = {
  ms: number;
  visits: number;
  /** Visits with no sign-out, which count for no time. */
  missed: number;
  /** Signed in right now. */
  open: boolean;
};

export type MeetingDay = {
  date: Date;
  /** How many of the members shown signed in that day. */
  present: number;
};

export type MemberRow = {
  member: ReportMember;
  /** By meeting day, in `days` order; null on a day they didn't sign in. */
  cells: (DayCell | null)[];
  attended: number;
  totalHours: number;
  /** Hours so far at the end of each of `timeline`'s days. */
  cumulative: number[];
};

export type Report = {
  /** Days someone signed in, oldest first. */
  days: MeetingDay[];
  rows: MemberRow[];
  /** Every day hours changed: meeting days, and days an admin adjusted hours. Oldest first. */
  timeline: Date[];
};

const HOUR = 3_600_000;

/** The start of the viewer's day a moment falls in. */
function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const sortedDays = (times: Iterable<number>) => [...new Set(times)].sort((a, b) => a - b);

/**
 * The report for the members `shown` lets through. A meeting day is a day one of them signed in,
 * and a missed sign-out counts as attending it, for no hours.
 */
export function buildReport(data: ReportData, shown: (member: ReportMember) => boolean): Report {
  const visible = data.members.map(shown);
  const sessions = data.sessions.filter((s) => visible[s.member]);
  const meetingTimes = sortedDays(
    sessions.filter((s) => s.kind !== "adjustment").map((s) => dayStart(s.signIn)),
  );
  const timelineTimes = sortedDays(sessions.map((s) => dayStart(s.signIn)));
  const dayIndex = new Map(meetingTimes.map((t, i) => [t, i]));
  const timeIndex = new Map(timelineTimes.map((t, i) => [t, i]));

  const working = new Map(
    data.members.flatMap((member, index) =>
      visible[index]
        ? [
            [
              index,
              {
                member,
                cells: new Array<DayCell | null>(meetingTimes.length).fill(null),
                changes: new Array<number>(timelineTimes.length).fill(0),
              },
            ] as const,
          ]
        : [],
    ),
  );
  for (const session of sessions) {
    const row = working.get(session.member);
    if (!row) continue;
    const day = dayStart(session.signIn);
    row.changes[timeIndex.get(day) as number] += session.ms;
    if (session.kind === "adjustment") continue;
    const at = dayIndex.get(day) as number;
    const cell = row.cells[at] ?? { ms: 0, visits: 0, missed: 0, open: false };
    cell.ms += session.ms;
    cell.visits += 1;
    if (session.kind === "missed") cell.missed += 1;
    if (session.kind === "open") cell.open = true;
    row.cells[at] = cell;
  }

  const rows = [...working.values()].map(({ member, cells, changes }) => {
    let running = 0;
    const cumulative = changes.map((change) => {
      running += change;
      return Math.max(0, running) / HOUR;
    });
    return {
      member,
      cells,
      attended: cells.filter(Boolean).length,
      totalHours: cumulative[cumulative.length - 1] ?? 0,
      cumulative,
    };
  });

  return {
    days: meetingTimes.map((t, i) => ({
      date: new Date(t),
      present: rows.filter((row) => row.cells[i]).length,
    })),
    rows,
    timeline: timelineTimes.map((t) => new Date(t)),
  };
}

/** What the grid's rows are in order of, and which way. */
export type RowSort = { by: "name" | "hours" | "meetings"; descending: boolean };

/** The order a column starts in: names A to Z, hours and meetings highest first. */
export const startingSort = (by: RowSort["by"]): RowSort => ({ by, descending: by !== "name" });

/** The rows in order. Equal hours go by meetings, equal meetings by hours, and then by name. */
export function sortRows(rows: MemberRow[], sort: RowSort): MemberRow[] {
  const byName = (a: MemberRow, b: MemberRow) =>
    a.member.displayName.localeCompare(b.member.displayName, undefined, { sensitivity: "base" });
  const direction = sort.descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (sort.by === "name") return direction * byName(a, b);
    const hours = a.totalHours - b.totalHours;
    const meetings = a.attended - b.attended;
    const [first, then] = sort.by === "hours" ? [hours, meetings] : [meetings, hours];
    return direction * first || direction * then || byName(a, b);
  });
}

/** The grid has five shades of green; the last has no upper limit. */
export const HEAT_LEVELS = 5;
const HEAT_STEPS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12];

/**
 * Hours per shade, picked so the shades spread over the team's own days: nine days in ten fall
 * inside the scale, and the longest ones share the brightest shade.
 */
export function heatStep(report: Report): number {
  const hours = report.rows
    .flatMap((row) => row.cells.flatMap((cell) => (cell && cell.ms > 0 ? [cell.ms / HOUR] : [])))
    .sort((a, b) => a - b);
  if (hours.length === 0) return 1;
  const typicalLongDay = hours[Math.floor((hours.length - 1) * 0.9)];
  return HEAT_STEPS.find((step) => step * HEAT_LEVELS >= typicalLongDay) ?? 12;
}

/** Which shade a day's time gets: 0 (least) to 4. */
export const heatLevel = (ms: number, step: number) =>
  Math.min(HEAT_LEVELS - 1, Math.floor(ms / HOUR / step));

/** A day they signed in but never out, so it counted for nothing. */
export const missedOnly = (cell: DayCell) => cell.missed > 0 && cell.ms <= 0 && !cell.open;

export const cellHours = (cell: DayCell) => cell.ms / HOUR;

/** "3.5 h", "12 h" */
export function formatHours(hours: number): string {
  const rounded = hours >= 100 ? Math.round(hours) : Math.round(hours * 10) / 10;
  return `${rounded.toLocaleString()} h`;
}

const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** The grid as a spreadsheet: a row per member, a column per meeting day, hours in each. */
export function reportCsv(report: Report): string {
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const lines = [
    [
      "Name",
      "Meetings attended",
      "Meeting days",
      "Total hours",
      ...report.days.map((d) => isoDay(d.date)),
    ],
    ...report.rows.map((row) => [
      row.member.displayName,
      row.attended,
      report.days.length,
      row.totalHours.toFixed(2),
      ...row.cells.map((cell) =>
        cell ? (missedOnly(cell) ? "missed sign-out" : cellHours(cell).toFixed(2)) : "",
      ),
    ]),
    ["Signed in", "", "", "", ...report.days.map((d) => d.present)],
  ];
  return lines.map((line) => line.map(quote).join(",")).join("\n");
}
