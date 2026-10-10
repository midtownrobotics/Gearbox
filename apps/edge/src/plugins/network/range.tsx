import { useSearchParams } from "react-router-dom";
import { formatDayKey, todayKey } from "../../shared/format";

// The dates a Network page looks at: `?from=YYYY-MM-DD&to=YYYY-MM-DD` in its address (local days
// of the box), so a range survives a reload and goes with links to a device or a site. No dates:
// the billing cycle (the worker works it out). Each change is a new history entry, so the
// browser's Back undoes a zoom.

/** A range as the worker describes it (workers/edge/src/modules/network/range.ts). */
export type PageRange = { fromDay: string; toDay: string; isCycle: boolean; days: number };

/** "YYYY-MM-DD" plus or minus whole days. */
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function useRange() {
  const [params, setParams] = useSearchParams();
  const from = params.get("from");
  const to = params.get("to");
  /** For the API: `?from=&to=` when the page has them (undefined ones aren't sent). */
  const query = { from: from ?? undefined, to: to ?? undefined };
  const set = (next: { from?: string; to?: string } | null) => {
    const p = new URLSearchParams(params);
    p.delete("from");
    p.delete("to");
    if (next?.from) p.set("from", next.from);
    if (next?.to) p.set("to", next.to);
    setParams(p);
  };
  return {
    query,
    /** The billing cycle again. */
    clear: () => set(null),
    setRange: (fromDay: string, toDay: string) => set({ from: fromDay, to: toDay }),
    /** Just that day (its hours). */
    zoom: (day: string) => set({ from: day, to: day }),
    /** A link to another Network page with the same range. */
    withRange: (path: string) => {
      const qs = new URLSearchParams({
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }).toString();
      return qs ? `${path}?${qs}` : path;
    },
  };
}

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-sm font-medium ${
    active
      ? "border-secondary-900 bg-secondary-900 text-white"
      : "border-secondary-300 bg-surface text-secondary-700 hover:border-secondary-500"
  }`;

/**
 * Pick the dates: the billing cycle, today, the last 7/30/90 days, or any two days; and a day at a time
 * once zoomed to one (‹ ›). `range` is the one the page shows (from the worker).
 */
export function RangePicker({ range }: { range: PageRange | null }) {
  const { clear, setRange, zoom } = useRange();
  const today = todayKey();
  const preset = (days: number) =>
    !!range &&
    !range.isCycle &&
    range.toDay === today &&
    range.fromDay === addDays(today, 1 - days);
  const single = range?.days === 1;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={chip(!!range?.isCycle)} onClick={clear}>
        Billing cycle
      </button>
      <button
        type="button"
        className={chip(!!range && !range.isCycle && single && range.fromDay === today)}
        onClick={() => zoom(today)}
      >
        Today
      </button>
      {PRESETS.map((p) => (
        <button
          key={p.days}
          type="button"
          className={chip(preset(p.days))}
          onClick={() => setRange(addDays(today, 1 - p.days), today)}
        >
          {p.label}
        </button>
      ))}
      {range && (
        <span className="flex flex-wrap items-center gap-1.5 text-sm text-secondary-600">
          {single && (
            <button
              type="button"
              aria-label="The day before"
              className="rounded px-1.5 text-secondary-500 hover:bg-secondary-100"
              onClick={() => zoom(addDays(range.fromDay, -1))}
            >
              ‹
            </button>
          )}
          <input
            type="date"
            aria-label="From"
            value={range.fromDay}
            max={range.toDay}
            onChange={(e) => e.target.value && setRange(e.target.value, range.toDay)}
            className="rounded-md border border-secondary-300 bg-surface px-2 py-1 text-sm"
          />
          <span>to</span>
          <input
            type="date"
            aria-label="To"
            value={range.toDay}
            min={range.fromDay}
            onChange={(e) => e.target.value && setRange(range.fromDay, e.target.value)}
            className="rounded-md border border-secondary-300 bg-surface px-2 py-1 text-sm"
          />
          {single && (
            <button
              type="button"
              aria-label="The day after"
              disabled={range.toDay >= today}
              className="rounded px-1.5 text-secondary-500 hover:bg-secondary-100 disabled:opacity-30"
              onClick={() => zoom(addDays(range.fromDay, 1))}
            >
              ›
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** "Oct 3 – Oct 9", or one day's name, for a card's title. */
export function rangeLabel(range: PageRange) {
  if (range.isCycle) return "this billing cycle";
  if (range.days === 1) return formatDayKey(range.fromDay);
  return `${formatDayKey(range.fromDay)} – ${formatDayKey(range.toDay)}`;
}
