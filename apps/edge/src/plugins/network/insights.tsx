import { useState } from "react";
import { formatBytes, formatDayKey } from "../../shared/format";
import { Stat } from "../../shared/ui";
import { BarChart } from "./bar-chart";

// What a range's usage says (the worker's `usageStats`): the total, the average day, the busiest
// and quietest days, and which weekdays and hours of the day the traffic comes at. The days are
// buttons that zoom the page to them; a weekday or an hour, clicked, says its average.

type Day = { day: string; dl: number; ul: number };

export type UsageStats = {
  total: { dl: number; ul: number };
  perDay: number;
  busiest: Day | null;
  quietest: Day | null;
  byWeekday: { day: string; bytes: number; days: number }[];
  byHour: number[] | null;
  days: number;
  singleDay: boolean;
};

const WEEKDAY_NAMES: Record<string, string> = {
  Mon: "Mondays",
  Tue: "Tuesdays",
  Wed: "Wednesdays",
  Thu: "Thursdays",
  Fri: "Fridays",
  Sat: "Saturdays",
  Sun: "Sundays",
};

/** "2pm" for an hour of the day (0–24). */
const clock = (h: number) => `${h % 12 || 12}${h % 24 < 12 ? "am" : "pm"}`;
/** "2pm–3pm". */
const hourName = (h: number) => `${clock(h)}–${clock(h + 1)}`;

function DayButton({ day, onDay }: { day: Day | null; onDay: (day: string) => void }) {
  if (!day) return <span className="text-base">—</span>;
  return (
    <button
      type="button"
      onClick={() => onDay(day.day)}
      className="text-left hover:text-primary-600"
      title="Show that day's hours"
    >
      <span className="block">{formatBytes(day.dl + day.ul)}</span>
      <span className="block text-xs font-normal text-secondary-500 underline">
        {formatDayKey(day.day)}
      </span>
    </button>
  );
}

/** The figures for a range, with the busiest and quietest days as links to them. */
export function InsightStats({
  stats,
  onDay,
  totalLabel = "Total",
}: {
  stats: UsageStats;
  onDay: (day: string) => void;
  totalLabel?: string;
}) {
  const total = stats.total.dl + stats.total.ul;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat
        label={totalLabel}
        value={formatBytes(total)}
        hint={`${formatBytes(stats.total.dl)} down · ${formatBytes(stats.total.ul)} up`}
      />
      <Stat
        label="Average day"
        value={stats.singleDay ? "—" : formatBytes(stats.perDay)}
        hint={stats.singleDay ? "one day shown" : `over ${stats.days} days`}
      />
      {!stats.singleDay && (
        <>
          <Stat label="Busiest day" value={<DayButton day={stats.busiest} onDay={onDay} />} />
          <Stat label="Quietest day" value={<DayButton day={stats.quietest} onDay={onDay} />} />
        </>
      )}
    </div>
  );
}

/**
 * When the traffic comes: the average for each weekday and each hour of the box's day. A bar,
 * clicked, says its figure underneath. Hours need hourly data (not kept for sites past 30 days).
 */
export function WhenCharts({ stats }: { stats: UsageStats }) {
  const [weekday, setWeekday] = useState<number | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const hours = stats.byHour;
  const peak = hours ? hours.indexOf(Math.max(...hours)) : -1;
  const busiestWeekday = stats.byWeekday.reduce(
    (best, w, i, all) => (w.bytes > all[best].bytes ? i : best),
    0,
  );

  return (
    <div className={`grid gap-6 ${hours ? "lg:grid-cols-2" : ""}`}>
      {!stats.singleDay && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-secondary-700">Average by weekday</h3>
          <BarChart
            single
            label="Average usage by weekday"
            bars={stats.byWeekday.map((w) => ({ label: w.day, tick: w.day, dl: w.bytes, ul: 0 }))}
            onSelect={(i) => setWeekday(weekday === i ? null : i)}
            selected={weekday}
          />
          <p className="mt-1 text-sm text-secondary-600">
            {weekday === null
              ? stats.byWeekday[busiestWeekday].bytes > 0
                ? `${WEEKDAY_NAMES[stats.byWeekday[busiestWeekday].day]} are busiest. Click a day for its average.`
                : "No usage yet."
              : `${WEEKDAY_NAMES[stats.byWeekday[weekday].day]}: ${formatBytes(stats.byWeekday[weekday].bytes)} on average (${stats.byWeekday[weekday].days} in this range).`}
          </p>
        </div>
      )}
      {hours && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-secondary-700">
            {stats.singleDay ? "By hour" : "Average by hour of the day"}
          </h3>
          <BarChart
            single
            label="Usage by hour of the day"
            bars={hours.map((bytes, h) => ({
              label: hourName(h),
              tick: h % 6 === 0 ? clock(h) : "",
              dl: bytes,
              ul: 0,
            }))}
            onSelect={(i) => setHour(hour === i ? null : i)}
            selected={hour}
          />
          <p className="mt-1 text-sm text-secondary-600">
            {hour === null
              ? peak >= 0 && hours[peak] > 0
                ? `The busiest hour is ${hourName(peak)}. Click an hour for its figure.`
                : "No usage yet."
              : `${hourName(hour)}: ${formatBytes(hours[hour])}${stats.singleDay ? "" : " on an average day"}.`}
          </p>
        </div>
      )}
    </div>
  );
}
