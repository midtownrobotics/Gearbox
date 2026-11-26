// SPDX-License-Identifier: AGPL-3.0-only

// Cards' dates are calendar days ("2026-11-21"), the same for everyone: a due date, and the day a
// card scheduled ahead goes on the board. "Today" is the viewer's own.

/** Today where the viewer is, as "YYYY-MM-DD". */
export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The day after `day`. */
function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** A day as cards show it: "Fri, Nov 21", with the year when it isn't this one. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(y === new Date().getFullYear() ? {} : { year: "numeric" }),
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** How close a due date is: past it, due today or tomorrow, or later. */
export function dueState(day: string): "overdue" | "soon" | "later" {
  const now = today();
  if (day < now) return "overdue";
  return day === now || day === nextDay(now) ? "soon" : "later";
}

/** Whether a card is still waiting for its day to go on the board. */
export const isScheduled = (card: { startsOn: string | null }) =>
  card.startsOn !== null && card.startsOn > today();
