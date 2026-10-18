// Times in a schedule are wall-clock slots: a local date ("2027-03-12") and a slot of that day,
// slot n being n × 15 minutes after midnight. A range starts at its first slot and ends before
// its last, so Lunch 12:00–1:15 is 48–53.

export const SLOT_MINUTES = 15;
/** Slots in a day; also the last a range can end at (midnight). */
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a string is a real calendar date, written YYYY-MM-DD. */
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** "12:15" → 49; null for a time that isn't on the 15-minute grid. "24:00" is 96, a range's end. */
export function slotOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (Number(match[2]) >= 60 || minutes % SLOT_MINUTES !== 0 || minutes > 24 * 60) return null;
  return minutes / SLOT_MINUTES;
}

/** 49 → "12:15" (24-hour; pages format it for the viewer). */
export function timeOf(slot: number): string {
  const minutes = slot * SLOT_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Whether `[start, end)` is a range of whole slots within one day, at least one long. */
export function isRange(start: unknown, end: unknown): boolean {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    (start as number) >= 0 &&
    (end as number) <= SLOTS_PER_DAY &&
    (start as number) < (end as number)
  );
}

/** Whether two ranges share a slot. */
export const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/**
 * The day and slot a moment falls in, in an event's time zone: which block is "now" there, or
 * `minutes` from now (for chat reminders). Wall-clock, so a daylight-saving change during the event only
 * moves which moment a slot is, never the slots themselves.
 */
export function slotAt(
  moment: Date,
  timeZone: string,
): { day: string; slot: number; minutes: number } {
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
      .formatToParts(moment)
      .map((part) => [part.type, part.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    slot: Math.floor(minutes / SLOT_MINUTES),
    /** Minutes since midnight there. */
    minutes,
  };
}

/** 49 → "12:15 PM", for chat messages (pages format times for the viewer). */
export function clockLabel(slot: number): string {
  const minutes = slot * SLOT_MINUTES;
  const hour = Math.floor(minutes / 60) % 24;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minutes % 60).padStart(2, "0")} ${suffix}`;
}

/** Whether a string is a time zone this runtime knows. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The moment (Unix ms) a slot of a day is in an event's time zone: the other way round from
 * `slotAt`. Slot 96 is the next midnight. The zone's offset is looked up twice, so a day that
 * changes to or from daylight saving time still lands on the wall-clock time.
 */
export function momentOf(day: string, slot: number, timeZone: string): number {
  const [year, month, date] = day.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, date, 0, slot * SLOT_MINUTES);
  let moment = wall;
  for (let i = 0; i < 2; i++) moment = wall - offsetAt(moment, timeZone);
  return moment;
}

/** How far ahead of UTC a zone's clocks are at a moment, in ms. */
function offsetAt(moment: number, timeZone: string): number {
  const here = slotAt(new Date(moment), timeZone);
  const [year, month, date] = here.day.split("-").map(Number);
  const minute = Math.floor(moment / 60_000) * 60_000;
  return Date.UTC(year, month - 1, date, 0, here.minutes) - minute;
}
