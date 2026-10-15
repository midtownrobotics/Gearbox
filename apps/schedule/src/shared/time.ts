// Times in a schedule are wall-clock slots of the event's own day: slot n is n × 15 minutes after
// midnight there, and a range ends before its last slot (Lunch 12:00–1:15 is 48–53). They're
// shown as the event's local time, in the viewer's own format, whatever zone the viewer is in.

export const SLOT_MINUTES = 15;
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;

/** A wall-clock time as a Date, read back in UTC so no zone moves it. */
const wallClock = (slot: number) => new Date(Date.UTC(2000, 0, 1, 0, slot * SLOT_MINUTES));

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
const hourFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const longDayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/** 37 → "9:15 AM" (or "09:15", as the viewer writes times). */
export const timeLabel = (slot: number) => timeFormat.format(wallClock(slot));
/** 36 → "9 AM", for the grid's hour marks. */
export const hourLabel = (slot: number) => hourFormat.format(wallClock(slot));
/** 37 → ":15", for the grid's columns between hours. */
export const quarterLabel = (slot: number) =>
  `:${String((slot % 4) * SLOT_MINUTES).padStart(2, "0")}`;

/** 69 → "5:15": the hour as the viewer writes it, and the minutes, without AM or PM. */
export function shortTime(slot: number): string {
  const hour = hourFormat.formatToParts(wallClock(slot)).find((p) => p.type === "hour")?.value;
  return `${hour ?? Math.floor(slot / 4)}${quarterLabel(slot)}`;
}

/** 48, 53 → "12:00 PM – 1:15 PM". */
export const spanLabel = (start: number, end: number) => `${timeLabel(start)} – ${timeLabel(end)}`;

const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);
/** "2027-03-12" → "Fri, Mar 12". */
export const dayLabel = (day: string) => dayFormat.format(dayDate(day));
/** "2027-03-12" → "Friday, March 12". */
export const longDayLabel = (day: string) => longDayFormat.format(dayDate(day));

/** "Mar 12 – 14, 2027"-ish: an event's dates, or null with none set. */
export function datesLabel(first: string | null, last: string | null): string | null {
  if (!first) return null;
  const format = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (!last || last === first) return format.format(dayDate(first));
  return format.formatRange(dayDate(first), dayDate(last));
}

/** The slots a time can be set to between two bounds: `[from, to]` inclusive. */
export const slotOptions = (from = 0, to = SLOTS_PER_DAY) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The day and slot it is now where the event is: for the "now" mark. */
export function nowAt(timeZone: string): { day: string; slot: number } | null {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date())
        .map((part) => [part.type, part.value]),
    );
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return {
      day: `${parts.year}-${parts.month}-${parts.day}`,
      slot: Math.floor(minutes / SLOT_MINUTES),
    };
  } catch {
    return null;
  }
}

/** The viewer's own time zone, to start a new schedule with. */
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Every time zone the browser knows, for picking an event's. */
export function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [browserTimeZone()];
  }
}
