// SPDX-License-Identifier: AGPL-3.0-only
import { Button, ErrorBanner, Page, PageLoading, focusRing } from "@g3/ui";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { type BoardCard, type BoardData, api, getErrorMessage } from "../../shared/api";
import { dueState, isScheduled, today } from "../../shared/dates";

// The board's cards on a month: each on its due date, and a card scheduled ahead also on the day
// it goes on the board. A card opens in the board's dialog (`/?card=<id>`). The month is in the
// address (`?month=2026-11`). On a phone it's a list of the month's days that have something.

/** How often it asks for everyone's changes, while it's showing. */
const POLL_MS = 15_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Entry = { card: BoardCard; kind: "due" | "starts" };

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m, d));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** "2026-11" from the address, or this month. */
function monthFrom(value: string | null): { year: number; month: number } {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) {
    return { year: Number(match[1]), month: Number(match[2]) - 1 };
  }
  const [y, m] = today().split("-").map(Number);
  return { year: y, month: m - 1 };
}

/** Every day the month's grid shows, Sunday to Saturday, whole weeks. */
function gridDays(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const weeks = Math.ceil((first + last) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => dayOf(year, month, i - first + 1));
}

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const { year, month } = monthFrom(params.get("month"));
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.board.$get().catch(() => null);
    if (!res) return setError("Can't reach Planner. Retrying…");
    if (!res.ok) return setError(await getErrorMessage(res));
    setData(await res.json());
    setError(null);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  /** What's on each day: due cards first, then those going on the board. */
  const byDay = useMemo(() => {
    const days = new Map<string, Entry[]>();
    const put = (day: string, entry: Entry) => days.set(day, [...(days.get(day) ?? []), entry]);
    for (const card of data?.cards ?? []) {
      if (card.dueDate) put(card.dueDate, { card, kind: "due" });
    }
    for (const card of data?.cards ?? []) {
      if (isScheduled(card) && card.startsOn) put(card.startsOn, { card, kind: "starts" });
    }
    return days;
  }, [data]);

  if (!data) {
    return error ? (
      <Page title="Calendar">
        <ErrorBanner message={error} />
      </Page>
    ) : (
      <PageLoading />
    );
  }

  const days = gridDays(year, month);
  const now = today();
  const inMonth = (day: string) => Number(day.slice(5, 7)) - 1 === month;
  const go = (y: number, m: number) => {
    const date = new Date(Date.UTC(y, m, 1));
    setParams({ month: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}` });
  };
  const title = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month, 1)));
  const listed = days.filter((day) => inMonth(day) && byDay.has(day));
  const undated = data.cards.filter((c) => !c.dueDate && !isScheduled(c)).length;

  return (
    <Page
      title="Calendar"
      description="Cards on their due dates, and scheduled cards on the day they go on the board. Open one to change it."
      width="full"
    >
      {error && <ErrorBanner message={error} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-secondary-900">{title}</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Previous month"
            onClick={() => go(year, month - 1)}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setParams({})}>
            Today
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Next month"
            onClick={() => go(year, month + 1)}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      </div>

      {/* From tablet width up: the month as a grid. */}
      <div className="hidden overflow-hidden rounded-xl border border-line md:block">
        <div className="grid grid-cols-7 border-b border-line bg-inset">
          {WEEKDAYS.map((name) => (
            <div key={name} className="px-2 py-1.5 text-xs font-semibold text-secondary-600">
              {name}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => (
            <div
              key={day}
              className={`min-h-28 min-w-0 space-y-1 border-line p-1.5 ${i % 7 ? "border-l" : ""} ${i >= 7 ? "border-t" : ""} ${inMonth(day) ? "bg-surface" : "bg-page"}`}
            >
              <DayNumber day={day} today={day === now} faded={!inMonth(day)} />
              <ul className="space-y-1">
                {byDay.get(day)?.map((entry) => (
                  <li key={`${entry.kind}-${entry.card.id}`}>
                    <EntryLink entry={entry} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* On a phone: the month's days that have something, in order. */}
      <div className="space-y-3 md:hidden">
        {listed.length === 0 && (
          <p className="text-sm text-secondary-500">Nothing is due or scheduled this month.</p>
        )}
        {listed.map((day) => (
          <section key={day} className="rounded-xl border border-line bg-surface p-3">
            <h3
              className={`mb-2 text-sm font-semibold ${day === now ? "text-primary-700" : "text-secondary-700"}`}
            >
              {new Intl.DateTimeFormat("en-US", {
                timeZone: "UTC",
                weekday: "long",
                month: "long",
                day: "numeric",
              }).format(new Date(`${day}T00:00:00Z`))}
              {day === now && " · Today"}
            </h3>
            <ul className="space-y-1">
              {byDay.get(day)?.map((entry) => (
                <li key={`${entry.kind}-${entry.card.id}`}>
                  <EntryLink entry={entry} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Legend />
      {undated > 0 && (
        <p className="text-sm text-secondary-500">
          {undated === 1 ? "1 card has" : `${undated} cards have`} no due date. Give one a due date
          from its dialog on the{" "}
          <Link to="/" className="font-medium text-primary-700 hover:underline">
            Board
          </Link>
          .
        </p>
      )}
    </Page>
  );
}

function DayNumber({ day, today, faded }: { day: string; today: boolean; faded: boolean }) {
  const n = Number(day.slice(8));
  return (
    <div className="flex justify-end">
      <span
        className={`flex size-6 items-center justify-center rounded-full text-xs ${
          today
            ? "bg-primary-600 font-semibold text-on-primary"
            : faded
              ? "text-secondary-400"
              : "text-secondary-700"
        }`}
      >
        {n}
      </span>
    </div>
  );
}

/** One card on a day: its title, colored like its due date, crossed off once it's done. */
function EntryLink({ entry }: { entry: Entry }) {
  const { card, kind } = entry;
  const done = card.column === "done";
  const state = kind === "due" && !done ? dueState(card.dueDate ?? "") : "later";
  const tone =
    kind === "starts"
      ? "border-dashed border-secondary-300 bg-surface text-secondary-600"
      : done
        ? "border-transparent bg-inset text-secondary-400 line-through"
        : state === "overdue"
          ? "border-transparent bg-red-50 text-red-800"
          : state === "soon"
            ? "border-transparent bg-amber-50 text-amber-800"
            : "border-transparent bg-primary-50 text-primary-800";
  const label =
    kind === "starts"
      ? `${card.title}: goes on the board`
      : `${card.title}: due${done ? ", done" : ""}`;
  return (
    <Link
      to={`/?card=${card.id}`}
      title={label}
      aria-label={label}
      className={`flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs ${tone} hover:brightness-95 ${focusRing}`}
    >
      {kind === "starts" && <CalendarPlus aria-hidden className="size-3 shrink-0" />}
      <span className="truncate">{card.title}</span>
    </Link>
  );
}

function Legend() {
  const item = (tone: string, text: string) => (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`size-3 rounded-sm border ${tone}`} />
      {text}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary-500">
      {item("border-transparent bg-primary-50", "Due")}
      {item("border-transparent bg-amber-50", "Due today or tomorrow")}
      {item("border-transparent bg-red-50", "Overdue")}
      {item("border-transparent bg-inset", "Done")}
      {item("border-dashed border-secondary-300 bg-surface", "Goes on the board")}
    </div>
  );
}
