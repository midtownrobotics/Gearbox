// Carriers bill in decimal units, so 1 GB = 1,000,000,000 bytes.
const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

export const GB = 1e9;

// Dates and times are the box's local time (it's in the shop), as the worker counts days and
// billing cycles. Set from /me when the app loads (shared/auth.tsx).
let timeZone = "UTC";
export function setBoxTimeZone(zone: string) {
  timeZone = zone;
}

const format = (ts: number, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(new Date(ts * 1000));

export const formatDate = (ts: number) => format(ts, { month: "short", day: "numeric" });
export const formatDateTime = (ts: number) =>
  format(ts, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const formatHour = (ts: number) => format(ts, { hour: "numeric" });
/** "2 PM – 3 PM" for the hour starting at ts (the box's time). */
export const formatHourRange = (ts: number) => `${formatHour(ts)} – ${formatHour(ts + 3600)}`;

/** Today's "YYYY-MM-DD" day key where the box is. */
export const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone });

/** "Sep 29" from a "2026-09-29" day key. */
export function formatDayKey(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatAgo(ts: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.round(now - ts));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** "in 45 min", "in 3 h 20 min", or a date/time when further out. */
export function formatUntil(ts: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.round(ts - now));
  if (s < 60) return "in under a minute";
  if (s < 3600) return `in ${Math.ceil(s / 60)} min`;
  if (s < 12 * 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m ? `in ${h} h ${m} min` : `in ${h} h`;
  }
  return `until ${formatDateTime(ts)}`;
}
