import { site } from "@g3/site-config";

// Sample data is written relative to when it's loaded, so the demo always looks current: "three
// days ago at 4 PM", not a fixed date.

const DAY = 24 * 60 * 60 * 1000;

/**
 * A moment `days` from `now` (negative: before), at `hour`:`minute` UTC on that day. Without an
 * hour, the same time of day as `now`.
 */
export function atDay(now: Date, days: number, hour?: number, minute = 0): Date {
  const at = new Date(now.getTime() + days * DAY);
  if (hour !== undefined) at.setUTCHours(hour, minute, 0, 0);
  return at;
}

/** Seconds since 1970 (how most tables store a moment). */
export const unix = (at: Date): number => Math.floor(at.getTime() / 1000);

/** A local date, "2026-10-15", `days` from `now` in the demo's time zone. */
export function demoDate(now: Date, days: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: site.demo.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() + days * DAY));
}

/** The hour (0–23) it is at `now` in the demo's time zone. */
export function demoHour(now: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: site.demo.timeZone,
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  return Number(hour);
}

/** How long a visitor's session lasts. */
export const DEMO_SESSION_SECONDS = 4 * 60 * 60;
