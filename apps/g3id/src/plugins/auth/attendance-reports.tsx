import { apiPath } from "@g3/site-config";
import { ChevronDown, ChevronUp, Download, Loader2 } from "lucide-react";
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type DayCell,
  HEAT_LEVELS,
  type MemberRow,
  type Report,
  type ReportData,
  type RowSort,
  buildReport,
  cellHours,
  formatHours,
  heatLevel,
  heatStep,
  missedOnly,
  reportCsv,
  sortRows,
  startingSort,
} from "./attendance-report";

// The Leaderboard page, for every member: who signed in on which meeting day (with how many each
// day, and each member's hours and meetings attended, which the rows can be put in order of), and
// everyone's hours as they added up. Drawn as plain HTML and SVG, with the chart colors in styles.css (`.att-report`).

const ATTENDANCE_API_URL = apiPath("attendance");

/** How many members the hours chart names; the rest are drawn in gray. */
const NAMED = 6;

const dayLabel = (date: Date) =>
  date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

// ── Tooltip ─────────────────────────────────────────────────────────────────────────────────

type Tip = {
  /** A point in the window. */
  x: number;
  y: number;
  /** Centered above the point, or beside it. */
  place: "above" | "left" | "right";
  content: ReactNode;
};

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  const style =
    tip.place === "above"
      ? // Centered on its point, and kept inside the window (it's at most 16rem wide).
        {
          left: Math.min(Math.max(tip.x, 136), window.innerWidth - 136),
          top: tip.y < 96 ? tip.y + 22 : tip.y - 8,
          transform: `translate(-50%, ${tip.y < 96 ? "0" : "-100%"})`,
        }
      : {
          left: tip.x + (tip.place === "right" ? 12 : -12),
          top: tip.y,
          transform: tip.place === "right" ? "none" : "translateX(-100%)",
        };
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-max max-w-64 rounded-lg border border-secondary-200 bg-surface px-2.5 py-1.5 text-xs text-secondary-600 shadow-lg"
      style={style}
    >
      {tip.content}
    </div>
  );
}

const strong = "font-semibold text-secondary-900";

// ── Sign-ins by meeting day ─────────────────────────────────────────────────────────────────

/** What a member's day says in words. */
function cellSummary(cell: DayCell): string {
  if (missedOnly(cell)) return "Missed sign-out";
  return formatHours(cellHours(cell));
}

function cellNotes(cell: DayCell): string[] {
  return [
    ...(cell.open ? ["Signed in now"] : []),
    ...(missedOnly(cell) ? ["No hours"] : []),
    ...(cell.visits > 1 ? [`${cell.visits} visits`] : []),
    ...(cell.missed > 0 && !missedOnly(cell)
      ? [`${cell.missed} missed sign-out${cell.missed === 1 ? "" : "s"}`]
      : []),
  ];
}

const stickyCell = "sticky left-0 z-10 border-r border-secondary-200 bg-surface pr-3";
/**
 * A member's name, hours and meetings, side by side. On a phone the numbers go under the name.
 * The name's column is never narrower than the name, or a grid wide enough to scroll squeezes it
 * to nothing.
 */
const memberColumns =
  "sm:grid sm:grid-cols-[minmax(max-content,1fr)_3.25rem_4.5rem] sm:items-baseline sm:gap-x-3";

type SortBy = RowSort["by"];

/** A column's name, as the button that puts the rows in its order (and again, the other way). */
function SortHeader({
  by,
  label,
  sort,
  onSort,
  className = "",
}: { by: SortBy; label: string; sort: RowSort; onSort: (by: SortBy) => void; className?: string }) {
  const active = sort.by === by;
  const Arrow = sort.descending ? ChevronDown : ChevronUp;
  return (
    <button
      type="button"
      onClick={() => onSort(by)}
      aria-pressed={active}
      title={`Sort by ${by}`}
      className={`inline-flex items-center gap-0.5 font-medium hover:text-secondary-900 ${
        active ? "text-secondary-900" : ""
      } ${className}`}
    >
      {label}
      {active && (
        <Arrow size={12} aria-label={sort.descending ? "highest first" : "lowest first"} />
      )}
    </button>
  );
}

/** A day's mark: a green ring while they're signed in, a red one for a missed sign-out. */
function dotClass(cell: DayCell): string {
  if (cell.open) return "border-2 border-[var(--att-open)]";
  if (missedOnly(cell)) return "border-2 border-[var(--att-missed)]";
  return "";
}

/** The table itself. It's large, so it only draws again when the report or its order changes. */
const GridTable = memo(function GridTable({
  report,
  step,
  sort,
  onSort,
}: { report: Report; step: number; sort: RowSort; onSort: (by: SortBy) => void }) {
  const { days, rows } = report;
  const most = Math.max(1, ...days.map((day) => day.present));
  // Each month's run of meeting days, for the month names above them.
  const months: { label: string; count: number }[] = [];
  const monthStart = days.map((day, i) => {
    const starts = i === 0 || days[i - 1].date.getMonth() !== day.date.getMonth();
    if (starts) {
      months.push({ label: day.date.toLocaleDateString(undefined, { month: "short" }), count: 1 });
    } else {
      months[months.length - 1].count += 1;
    }
    return starts && i > 0;
  });
  const divider = (d: number) => (monthStart[d] ? "border-l border-secondary-200" : "");

  return (
    <table className="border-separate border-spacing-0 text-xs">
      <thead>
        <tr>
          <td className={stickyCell} />
          {months.map((month, i) => (
            <th
              // biome-ignore lint/suspicious/noArrayIndexKey: months are in order and never move
              key={i}
              colSpan={month.count}
              className={`whitespace-nowrap px-1 pb-1 text-left font-medium text-secondary-600 ${
                i > 0 ? "border-l border-secondary-200" : ""
              }`}
            >
              {month.label}
            </th>
          ))}
        </tr>
        <tr>
          <th scope="row" className={`${stickyCell} pb-0.5 text-left align-bottom font-medium`}>
            <span className="text-secondary-600">Signed in</span>
          </th>
          {days.map((day, d) => (
            <td
              key={day.date.getTime()}
              data-d={d}
              className={`p-0 text-center align-bottom ${divider(d)}`}
            >
              <div className="mx-auto flex h-10 w-[18px] items-end justify-center">
                <div
                  className="w-2.5 rounded-t-[4px] bg-[var(--att-series-1)]"
                  style={{ height: `${Math.max(6, (day.present / most) * 100)}%` }}
                />
              </div>
              <div className="text-[10px] leading-4 tabular-nums text-secondary-600">
                {day.present}
              </div>
            </td>
          ))}
        </tr>
        <tr>
          <th className={`${stickyCell} border-b border-secondary-200 py-1 font-medium`}>
            {/* Laid out like the rows under it: on a phone, Hours and Meetings go under Member. */}
            <span className={`${memberColumns} block text-left text-secondary-600`}>
              <SortHeader by="name" label="Member" sort={sort} onSort={onSort} />
              <span className="block max-sm:text-[10px] max-sm:leading-4 sm:contents">
                <SortHeader
                  by="hours"
                  label="Hours"
                  sort={sort}
                  onSort={onSort}
                  className="sm:justify-self-end"
                />
                <span className="sm:hidden"> · </span>
                <SortHeader
                  by="meetings"
                  label="Meetings"
                  sort={sort}
                  onSort={onSort}
                  className="sm:justify-self-end"
                />
              </span>
            </span>
          </th>
          {days.map((day, d) => (
            <th
              key={day.date.getTime()}
              scope="col"
              data-d={d}
              aria-label={dayLabel(day.date)}
              className={`w-[18px] min-w-[18px] border-b border-secondary-200 py-1 text-[10px] font-normal tabular-nums text-secondary-500 ${divider(d)}`}
            >
              {day.date.getDate()}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={row.member.id} className="group">
            <th scope="row" className={`${stickyCell} h-[22px] font-normal group-hover:bg-inset`}>
              {/* On a phone the numbers sit under the name, so more days fit beside it. */}
              <span className={`${memberColumns} block max-sm:py-0.5`}>
                <span
                  className="block max-w-[7rem] truncate text-left font-medium text-secondary-900 sm:max-w-[14rem]"
                  title={row.member.displayName}
                >
                  {row.member.displayName}
                </span>
                <span className="block text-left tabular-nums text-secondary-500 max-sm:text-[10px] max-sm:leading-3 sm:contents">
                  <span className="sm:text-right sm:text-secondary-800">
                    {row.totalHours.toFixed(1)}
                    <span className="sm:hidden"> h</span>
                  </span>
                  <span className="sm:hidden"> · </span>
                  <span className="sm:text-right">
                    {row.attended}/{days.length}
                    <span className="sm:hidden"> meetings</span>
                  </span>
                </span>
              </span>
            </th>
            {row.cells.map((cell, d) => (
              <td
                key={days[d].date.getTime()}
                data-r={r}
                data-d={d}
                aria-label={cell ? cellSummary(cell) : undefined}
                className={`group/cell p-0 text-center group-hover:bg-inset ${divider(d)}`}
              >
                {cell && (
                  <span
                    className={`inline-block h-3 w-3 rounded-full align-middle group-hover/cell:ring-2 group-hover/cell:ring-secondary-400 ${dotClass(cell)}`}
                    style={
                      dotClass(cell)
                        ? undefined
                        : { background: `var(--att-heat-${heatLevel(cell.ms, step) + 1})` }
                    }
                  />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
});

/** "Under 1 h", "1–2 h", …, "4 h or more" */
function heatRange(level: number, step: number): string {
  const from = level * step;
  if (level === 0) return `Under ${formatHours(step)}`;
  if (level === HEAT_LEVELS - 1) return `${formatHours(from)} or more`;
  return `${from.toLocaleString()}–${formatHours(from + step)}`;
}

function SignInGrid({
  report,
  sort,
  onSort,
}: { report: Report; sort: RowSort; onSort: (by: SortBy) => void }) {
  const step = useMemo(() => heatStep(report), [report]);
  const scroller = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  // The latest meetings are the ones looked at most: start at that end.
  // biome-ignore lint/correctness/useExhaustiveDependencies: again when the days change
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [report.days.length]);

  function showTip(event: PointerEvent<HTMLDivElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-d]");
    if (!target) return setTip(null);
    const day = report.days[Number(target.dataset.d)];
    const box = target.getBoundingClientRect();
    const at = { x: box.left + box.width / 2, y: box.top, place: "above" as const };
    if (target.dataset.r === undefined) {
      return setTip({
        ...at,
        content: (
          <>
            <p className={strong}>{day.present} signed in</p>
            <p>{dayLabel(day.date)}</p>
          </>
        ),
      });
    }
    const row = report.rows[Number(target.dataset.r)];
    const cell = row.cells[Number(target.dataset.d)];
    setTip({
      ...at,
      content: (
        <>
          <p className={strong}>{cell ? cellSummary(cell) : "Not signed in"}</p>
          <p>{row.member.displayName}</p>
          <p>{[dayLabel(day.date), ...(cell ? cellNotes(cell) : [])].join(" · ")}</p>
        </>
      ),
    });
  }

  return (
    <>
      <div
        ref={scroller}
        className="overflow-x-auto pb-2"
        onPointerOver={showTip}
        onPointerLeave={() => setTip(null)}
        onScroll={() => setTip(null)}
      >
        <GridTable report={report} step={step} sort={sort} onSort={onSort} />
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary-600">
        {Array.from({ length: HEAT_LEVELS }, (_, level) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed scale
          <li key={level} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: `var(--att-heat-${level + 1})` }}
            />
            {heatRange(level, step)}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-[var(--att-open)]" />
          Signed in now
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-[var(--att-missed)]" />
          Missed sign-out (no hours)
        </li>
      </ul>
      <Tooltip tip={tip} />
    </>
  );
}

// ── Hours over time ─────────────────────────────────────────────────────────────────────────

/** An element's width, kept up to date, so the chart is drawn at its real size. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Each named member's color, 0 to NAMED - 1. Someone keeps theirs for as long as they stay named,
 * so leaving mentors out doesn't repaint the lines that are still there.
 */
function useColors(ids: string[]): Map<string, number> {
  const held = useRef(new Map<string, number>());
  const key = ids.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the ids
  return useMemo(() => {
    const next = new Map<string, number>();
    const free = Array.from({ length: NAMED }, (_, i) => i);
    const take = (slot: number) => free.splice(free.indexOf(slot), 1);
    for (const id of ids) {
      const slot = held.current.get(id);
      if (slot !== undefined && free.includes(slot)) {
        next.set(id, slot);
        take(slot);
      }
    }
    for (const id of ids) {
      if (!next.has(id) && free.length > 0) {
        next.set(id, free[0]);
        take(free[0]);
      }
    }
    held.current = next;
    return next;
  }, [key]);
}

/** A round number of hours between gridlines, for about four of them. */
function tickStep(max: number): number {
  return (
    [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((step) => max / step <= 5) ?? 2000
  );
}

const PAD = { top: 12, right: 16, bottom: 26, left: 42 };

function HoursChart({ report }: { report: Report }) {
  const { timeline } = report;
  const [box, width] = useWidth<HTMLDivElement>();
  const height = width < 480 ? 240 : 320;
  const [hover, setHover] = useState<{ at: number; nearest: string | null; tip: Tip } | null>(null);

  const ranked = useMemo(
    () =>
      report.rows
        .filter((row) => row.cumulative.some((hours) => hours > 0))
        .sort(
          (a, b) =>
            b.totalHours - a.totalHours || a.member.displayName.localeCompare(b.member.displayName),
        ),
    [report],
  );
  const named = ranked.slice(0, NAMED);
  const colors = useColors(named.map((row) => row.member.id));
  const colorOf = (row: MemberRow) => {
    const slot = colors.get(row.member.id);
    return slot === undefined ? null : `var(--att-series-${slot + 1})`;
  };

  if (ranked.length === 0) {
    return <p className="text-sm text-secondary-500">No hours yet this school year.</p>;
  }

  const first = timeline[0].getTime();
  const span = Math.max(86_400_000, timeline[timeline.length - 1].getTime() - first);
  const step = tickStep(Math.max(1, ...ranked.map((row) => Math.max(...row.cumulative))));
  const top = Math.ceil(Math.max(1, ...ranked.map((row) => Math.max(...row.cumulative))) / step);
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  // A single day sits in the middle.
  const xAt = (time: number) =>
    PAD.left + (timeline.length === 1 ? 0.5 : (time - first) / span) * plotW;
  const x = (i: number) => xAt(timeline[i].getTime());
  const y = (hours: number) => PAD.top + plotH - (hours / (top * step)) * plotH;

  /** A member's line, from the day before their first hours. */
  const path = (row: MemberRow) => {
    const start = Math.max(0, row.cumulative.findIndex((hours) => hours > 0) - 1);
    return row.cumulative
      .slice(start)
      .map((hours, i) => `${i === 0 ? "M" : "L"}${x(start + i).toFixed(1)},${y(hours).toFixed(1)}`)
      .join("");
  };

  // Along the bottom: a name where each month starts (and the first month's, when there's room
  // before the next), or a few dates when it's all within a month or two.
  const month = (date: Date) => date.toLocaleDateString(undefined, { month: "short" });
  const monthStarts: { x: number; label: string }[] = [];
  for (
    let at = new Date(timeline[0].getFullYear(), timeline[0].getMonth() + 1, 1);
    at.getTime() <= first + span;
    at = new Date(at.getFullYear(), at.getMonth() + 1, 1)
  ) {
    monthStarts.push({ x: xAt(at.getTime()), label: month(at) });
  }
  const ticks =
    monthStarts.length >= 2
      ? [
          ...(monthStarts[0].x - PAD.left >= 44
            ? [{ x: PAD.left, label: month(timeline[0]) }]
            : []),
          ...monthStarts,
        ]
      : [...new Set([0, Math.floor((timeline.length - 1) / 2), timeline.length - 1])].map((i) => ({
          x: x(i),
          label: timeline[i].toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        }));
  // On a narrow chart, a name that would run into the one before it is left out.
  const spaced = ticks.reduce<typeof ticks>((kept, tick) => {
    const before = kept[kept.length - 1];
    if (!before || tick.x - before.x >= 36) kept.push(tick);
    return kept;
  }, []);
  /** A label at either edge is tucked inside the plot. */
  const anchor = (at: number) =>
    at - PAD.left < 16 ? "start" : width - PAD.right - at < 16 ? "end" : "middle";

  function track(event: PointerEvent<SVGRectElement>) {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const frame = svg.getBoundingClientRect();
    const px = event.clientX - frame.left;
    const py = event.clientY - frame.top;
    // The day nearest the pointer, then the line nearest it on that day.
    let at = 0;
    for (let i = 1; i < timeline.length; i++) {
      if (Math.abs(x(i) - px) < Math.abs(x(at) - px)) at = i;
    }
    let nearest: MemberRow | null = null;
    for (const row of ranked) {
      if (
        !nearest ||
        Math.abs(y(row.cumulative[at]) - py) < Math.abs(y(nearest.cumulative[at]) - py)
      ) {
        nearest = row;
      }
    }
    const extra = nearest && !colors.has(nearest.member.id) ? nearest : null;
    const listed = [...named].sort((a, b) => b.cumulative[at] - a.cumulative[at]);
    setHover({
      at,
      nearest: extra?.member.id ?? null,
      tip: {
        x: frame.left + x(at),
        y: frame.top + PAD.top,
        place: x(at) > width / 2 ? "left" : "right",
        content: (
          <>
            <p className="mb-1">{dayLabel(timeline[at])}</p>
            <ul className="space-y-0.5">
              {[...listed, ...(extra ? [extra] : [])].map((row) => (
                <li key={row.member.id} className="flex items-center gap-2">
                  <span
                    className="inline-block h-0.5 w-3 shrink-0 rounded-full bg-secondary-500"
                    style={{ background: colorOf(row) ?? undefined }}
                  />
                  <span className={`${strong} tabular-nums`}>
                    {formatHours(row.cumulative[at])}
                  </span>
                  <span className="truncate">{row.member.displayName}</span>
                </li>
              ))}
            </ul>
          </>
        ),
      },
    });
  }

  const others = ranked.length - named.length;
  return (
    <>
      <div ref={box}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Hours over time for ${ranked.length} members. Most hours: ${named
              .map((row) => `${row.member.displayName}, ${formatHours(row.totalHours)}`)
              .join("; ")}.`}
            className="block touch-pan-y"
          >
            {Array.from({ length: top + 1 }, (_, i) => i * step).map((hours) => (
              <g key={hours}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(hours)}
                  y2={y(hours)}
                  className={hours === 0 ? "stroke-secondary-300" : "stroke-secondary-100"}
                />
                <text
                  x={PAD.left - 8}
                  y={y(hours) + 4}
                  textAnchor="end"
                  className="fill-secondary-500 text-[11px] tabular-nums"
                >
                  {hours.toLocaleString()}
                </text>
              </g>
            ))}
            {spaced.map((tick) => (
              <text
                key={tick.x}
                x={tick.x}
                y={height - 8}
                textAnchor={anchor(tick.x)}
                className="fill-secondary-500 text-[11px]"
              >
                {tick.label}
              </text>
            ))}

            {/* Everyone else first, in gray, so the named lines sit on top. */}
            {ranked.slice(NAMED).map((row) => (
              <path
                key={row.member.id}
                d={path(row)}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
                className={
                  hover?.nearest === row.member.id
                    ? "stroke-secondary-700 stroke-2"
                    : "stroke-secondary-300 stroke-1"
                }
              />
            ))}
            {named.map((row) => (
              <path
                key={row.member.id}
                d={path(row)}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                stroke={colorOf(row) ?? undefined}
              />
            ))}

            {hover && (
              <g pointerEvents="none">
                <line
                  x1={x(hover.at)}
                  x2={x(hover.at)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  className="stroke-secondary-400"
                />
                {named.map((row) => (
                  <circle
                    key={row.member.id}
                    cx={x(hover.at)}
                    cy={y(row.cumulative[hover.at])}
                    r={4}
                    fill={colorOf(row) ?? undefined}
                    strokeWidth={2}
                    className="stroke-[var(--g3-surface)]"
                  />
                ))}
              </g>
            )}
            <rect
              x={PAD.left}
              y={PAD.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={track}
              onPointerDown={track}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary-600">
        {named.map((row) => (
          <li key={row.member.id} className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ background: colorOf(row) ?? undefined }}
            />
            <span className="text-secondary-900">{row.member.displayName}</span>
            <span className="tabular-nums">{formatHours(row.totalHours)}</span>
          </li>
        ))}
        {others > 0 && (
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-px w-4 bg-secondary-400" />
            {others} more
          </li>
        )}
      </ul>
      <Tooltip tip={hover?.tip ?? null} />
    </>
  );
}

// ── The cards ───────────────────────────────────────────────────────────────────────────────

function ReportCard({
  title,
  action,
  children,
}: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-secondary-200 bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-lg font-bold text-secondary-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AttendanceReports() {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [studentsOnly, setStudentsOnly] = useState(false);
  // The page is a leaderboard: it opens with the most hours first.
  const [sort, setSort] = useState<RowSort>(() => startingSort("hours"));
  // A column's name puts the rows in its order; the same one again turns them round.
  const sortBy = useCallback(
    (by: SortBy) =>
      setSort((current) =>
        current.by === by ? { by, descending: !current.descending } : startingSort(by),
      ),
    [],
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${ATTENDANCE_API_URL}/report`, { credentials: "include" });
        if (!res.ok) throw new Error();
        setData((await res.json()) as ReportData);
      } catch {
        setError("Couldn't load the attendance reports.");
      }
    })();
  }, []);

  const report = useMemo(
    () => data && buildReport(data, (member) => !(studentsOnly && member.isMentor)),
    [data, studentsOnly],
  );
  // The grid, and the file made from it, with its rows in the chosen order.
  const ordered = useMemo(
    () => report && { ...report, rows: sortRows(report.rows, sort) },
    [report, sort],
  );

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data || !report || !ordered) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-secondary-600">
        <Loader2 size={20} className="animate-spin" /> Loading reports…
      </div>
    );
  }

  function download() {
    if (!data || !ordered) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([reportCsv(ordered)], { type: "text/csv;charset=utf-8;" }),
    );
    link.download = `attendance-${data.year}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="att-report space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {data.members.some((member) => member.isMentor) ? (
          <label className="flex w-fit items-center gap-2 text-sm text-secondary-700">
            <input
              type="checkbox"
              checked={studentsOnly}
              onChange={(e) => setStudentsOnly(e.target.checked)}
              className="h-4 w-4 accent-primary-500"
            />
            Students only
          </label>
        ) : (
          <span />
        )}
        <span className="text-sm text-secondary-600">School year {data.year}</span>
      </div>
      {report.days.length === 0 ? (
        <p className="text-sm text-secondary-600">No one has signed in yet this school year.</p>
      ) : (
        <>
          <ReportCard
            title="Sign-ins by meeting day"
            action={
              <button
                type="button"
                onClick={download}
                className="inline-flex items-center gap-1.5 rounded-lg border border-secondary-300 bg-surface px-3 py-1.5 text-sm font-medium text-secondary-700 hover:bg-secondary-50"
              >
                <Download size={14} />
                Download CSV
              </button>
            }
          >
            <SignInGrid report={ordered} sort={sort} onSort={sortBy} />
          </ReportCard>
          <ReportCard title="Hours over time">
            <HoursChart report={report} />
          </ReportCard>
        </>
      )}
    </div>
  );
}
