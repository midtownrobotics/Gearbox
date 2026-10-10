// A team's attendance settings (attendance_settings), edited on G3ID's Attendance admin page.

export type AttendanceSettings = {
  /** The school year starts on this month (1–12) and day. */
  schoolYearStartMonth: number;
  schoolYearStartDay: number;
  /** A session still open after this many hours is closed, and its time doesn't count. */
  autoSignOutHours: number;
};

/** What a team that hasn't saved any gets. */
export const DEFAULT_SETTINGS: AttendanceSettings = {
  schoolYearStartMonth: 8,
  schoolYearStartDay: 1,
  autoSignOutHours: 12,
};

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** The settings in a request body, or the reason they're not valid. */
export function parseSettings(value: unknown): AttendanceSettings | string {
  const v = (value ?? {}) as Record<string, unknown>;
  const month = v.schoolYearStartMonth;
  const day = v.schoolYearStartDay;
  const hours = v.autoSignOutHours;
  if (!Number.isInteger(month) || (month as number) < 1 || (month as number) > 12) {
    return "The school year's start month must be 1–12.";
  }
  const maxDay = DAYS_IN_MONTH[(month as number) - 1];
  if (!Number.isInteger(day) || (day as number) < 1 || (day as number) > maxDay) {
    return `The school year's start day must be 1–${maxDay} for that month.`;
  }
  if (!Number.isInteger(hours) || (hours as number) < 1 || (hours as number) > 24) {
    return "Auto sign-out must be 1–24 hours.";
  }
  return {
    schoolYearStartMonth: month as number,
    schoolYearStartDay: day as number,
    autoSignOutHours: hours as number,
  };
}

/** The school year a date falls in ("2026-2027"), by the team's start date. */
export function schoolYear(date: Date, settings: AttendanceSettings): string {
  const month = date.getMonth() + 1;
  const startsThisYear =
    month > settings.schoolYearStartMonth ||
    (month === settings.schoolYearStartMonth && date.getDate() >= settings.schoolYearStartDay);
  const start = startsThisYear ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}-${start + 1}`;
}

export const autoSignOutMs = (settings: AttendanceSettings) =>
  settings.autoSignOutHours * 3_600_000;
