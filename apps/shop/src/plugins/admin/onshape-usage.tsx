import { Button, Chip, ErrorBanner, Loading, ProgressBar, Stat, SuccessBanner } from "@g3/ui";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { onshapeProblemText, refreshOnshapeStatus } from "../../shared/onshape-banner";
import { sectionHeading } from "./admin-styles";

type UsageDay = { day: string; kind: string; calls: number; errors: number };
type Usage = {
  kinds: Record<string, string>;
  today: string;
  keys: { onlyCurrent: boolean; currentSince: string | null; others: number };
  days: UsageDay[];
  older: { kind: string; calls: number; errors: number }[];
  errors: { at: number; kind: string; status: number; message: string | null }[];
};

const RANGES = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "365", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: null },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

/** The UTC day `back` days before `today` (both YYYY-MM-DD). */
function dayBefore(today: string, back: number) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

const count = (n: number) => n.toLocaleString();

function when(at: number) {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The Onshape API Usage section: how many calls Shop has made to Onshape with the team's keys, by
 * day and by what they were for, and the latest ones that failed.
 */
export function OnshapeUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>("30");
  // Only the current API keys' calls, or every key's the team has used.
  const [allKeys, setAllKeys] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{ ok: boolean; text: string } | null>(null);

  async function load(all = allKeys) {
    try {
      const res = await api.admin.onshape.usage.$get({ query: all ? { keys: "all" } : {} });
      if (!res.ok) {
        setError(await getErrorMessage(res as unknown as Response));
        return;
      }
      setUsage((await res.json()) as Usage);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the usage");
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once
  useEffect(() => {
    void load();
  }, []);

  async function check() {
    setChecking(true);
    setChecked(null);
    try {
      const res = await api.admin.onshape.check.$post();
      if (!res.ok) {
        setChecked({ ok: false, text: await getErrorMessage(res as unknown as Response) });
      } else {
        const { ok, status } = (await res.json()) as { ok: boolean; status: number };
        setChecked(
          ok
            ? { ok: true, text: "Onshape accepted the team's API keys." }
            : { ok: false, text: onshapeProblemText(status) },
        );
      }
      await load();
      refreshOnshapeStatus();
    } finally {
      setChecking(false);
    }
  }

  function showAllKeys(all: boolean) {
    setAllKeys(all);
    void load(all);
  }

  const view = useMemo(() => (usage ? summarize(usage, range) : null), [usage, range]);

  if (error) return <ErrorBanner message={error} />;
  if (!usage || !view) return <Loading />;

  return (
    <div className="space-y-5">
      <p className="text-sm text-secondary-500">
        Every call Shop makes to Onshape with the team's API keys counts toward the team's Onshape
        API allowance. Days are in UTC.
      </p>

      {(usage.keys.others > 0 || allKeys) && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2">
            <Chip selected={!allKeys} onClick={() => showAllKeys(false)}>
              Current API keys
            </Chip>
            <Chip selected={allKeys} onClick={() => showAllKeys(true)}>
              All API keys
            </Chip>
          </div>
          <p className="text-xs text-secondary-500">
            {allKeys
              ? "Calls made with every API key the team has saved."
              : usage.keys.currentSince
                ? `Calls made with the current keys, first used ${new Date(
                    `${usage.keys.currentSince}T00:00:00Z`,
                  ).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  })}.`
                : "The current keys haven't made a call yet."}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <Chip key={r.key} selected={range === r.key} onClick={() => setRange(r.key)}>
              {r.label}
            </Chip>
          ))}
        </div>
        <Button variant="secondary" size="sm" disabled={checking} onClick={check}>
          {checking ? "Checking…" : "Check connection"}
        </Button>
      </div>
      {checked &&
        (checked.ok ? (
          <SuccessBanner message={checked.text} />
        ) : (
          <ErrorBanner message={checked.text} />
        ))}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Calls" value={count(view.calls)} />
        <Stat label="Failed" value={count(view.errors)} />
        <Stat label="Today" value={count(view.today)} hint="UTC" />
        <Stat
          label="Per day"
          value={count(Math.round(view.perDay))}
          hint={view.days === null ? "Over the last 12 months" : "On average"}
        />
      </div>

      <DailyChart bars={view.bars} title={view.chartTitle} />

      <div className="space-y-2">
        <h3 className={sectionHeading}>By kind of call</h3>
        {view.byKind.length === 0 ? (
          <p className="text-sm text-secondary-500">No calls in this time.</p>
        ) : (
          <div className="relative border border-secondary-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-inset text-left text-xs font-semibold uppercase tracking-wider text-secondary-500">
                  <th className="px-3 py-2">Call</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Failed</th>
                  <th className="px-3 py-2 w-1/3">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-200">
                {view.byKind.map((k) => (
                  <tr key={k.kind}>
                    <td className="px-3 py-2 text-secondary-900 min-w-40">
                      {usage.kinds[k.kind] ?? k.kind}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{count(k.calls)}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${k.errors > 0 ? "text-red-700" : "text-secondary-500"}`}
                    >
                      {count(k.errors)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <ProgressBar
                          className="flex-1 min-w-16"
                          percent={view.calls ? (k.calls / view.calls) * 100 : 0}
                        />
                        <span className="w-10 text-right text-xs tabular-nums text-secondary-500">
                          {view.calls ? Math.round((k.calls / view.calls) * 100) : 0}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className={sectionHeading}>Recent failed calls</h3>
        {usage.errors.length === 0 ? (
          <p className="text-sm text-secondary-500">No failed calls.</p>
        ) : (
          <div className="relative border border-secondary-200 rounded-lg overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="bg-inset text-left text-xs font-semibold uppercase tracking-wider text-secondary-500">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Call</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Onshape said</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-200">
                {usage.errors.map((e) => (
                  <tr key={`${e.at}-${e.kind}`} className="align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-secondary-600">{when(e.at)}</td>
                    <td className="px-3 py-2 min-w-36 text-secondary-900">
                      {usage.kinds[e.kind] ?? e.kind}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-red-700">
                      {e.status === 0 ? "No answer" : e.status}
                    </td>
                    <td className="px-3 py-2 min-w-48 text-secondary-600">{e.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

type Bar = { key: string; label: string; calls: number; errors: number };

/** The range's totals, its calls by kind (most first) and the chart's bars. */
function summarize(usage: Usage, range: RangeKey) {
  const { days } = RANGES.find((r) => r.key === range) ?? RANGES[1];
  const from = days === null ? null : dayBefore(usage.today, days - 1);
  const rows = from === null ? usage.days : usage.days.filter((d) => d.day >= from);

  const kinds = new Map<string, { kind: string; calls: number; errors: number }>();
  const add = (kind: string, calls: number, errors: number) => {
    const k = kinds.get(kind) ?? { kind, calls: 0, errors: 0 };
    k.calls += calls;
    k.errors += errors;
    kinds.set(kind, k);
  };
  for (const r of rows) add(r.kind, r.calls, r.errors);
  if (days === null) for (const o of usage.older) add(o.kind, o.calls, o.errors);
  const byKind = [...kinds.values()].sort((a, b) => b.calls - a.calls);
  const calls = byKind.reduce((n, k) => n + k.calls, 0);
  const errors = byKind.reduce((n, k) => n + k.errors, 0);
  const today = usage.days.filter((d) => d.day === usage.today).reduce((n, d) => n + d.calls, 0);
  const lastYear = usage.days.reduce((n, d) => n + d.calls, 0);

  // Up to a month, a bar a day; longer, a bar a month over the last 12.
  let bars: Bar[];
  let chartTitle: string;
  if (days !== null && days <= 30) {
    bars = Array.from({ length: days }, (_, i) => {
      const day = dayBefore(usage.today, days - 1 - i);
      const label = new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
      return { key: day, label, calls: 0, errors: 0 };
    });
    chartTitle = "Calls per day";
  } else {
    const start = new Date(`${usage.today}T00:00:00Z`);
    bars = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 11 + i, 1));
      const label = d.toLocaleDateString(undefined, {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      });
      return { key: d.toISOString().slice(0, 7), label, calls: 0, errors: 0 };
    });
    chartTitle = "Calls per month";
  }
  const byKey = new Map(bars.map((b) => [b.key, b]));
  for (const r of usage.days) {
    const bar = byKey.get(r.day) ?? byKey.get(r.day.slice(0, 7));
    if (!bar) continue;
    bar.calls += r.calls;
    bar.errors += r.errors;
  }

  return {
    days,
    calls,
    errors,
    today,
    perDay: days === null ? lastYear / 365 : calls / days,
    byKind,
    bars,
    chartTitle,
  };
}

/** Calls per bar: the ones that worked in the team's color, the failed ones in red on top. */
function DailyChart({ bars, title }: { bars: Bar[]; title: string }) {
  const highest = Math.max(1, ...bars.map((b) => b.calls));
  const anyFailed = bars.some((b) => b.errors > 0);
  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={sectionHeading}>{title}</h3>
        {anyFailed && (
          <span className="flex items-center gap-3 text-xs text-secondary-600">
            <span className="flex items-center gap-1">
              <span aria-hidden className="size-2.5 rounded-sm bg-primary-500" /> Worked
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden className="size-2.5 rounded-sm bg-red-500" /> Failed
            </span>
          </span>
        )}
      </figcaption>
      <div className="flex">
        <div className="flex flex-col justify-between pr-2 text-right text-xs tabular-nums text-secondary-400 h-32">
          <span>{count(highest)}</span>
          <span>0</span>
        </div>
        <div className="flex-1 min-w-0 flex items-end gap-0.5 h-32 border-b border-line">
          {bars.map((b, i) => {
            const worked = b.calls - b.errors;
            // Kept inside the chart at either end, so it never runs off a phone's screen.
            const align =
              i < bars.length / 3
                ? "left-0"
                : i >= (bars.length * 2) / 3
                  ? "right-0"
                  : "left-1/2 -translate-x-1/2";
            return (
              <div
                key={b.key}
                className="group relative flex-1 min-w-0 h-full flex flex-col justify-end"
                role="img"
                aria-label={`${b.label}: ${b.calls} calls, ${b.errors} failed`}
              >
                {b.errors > 0 && (
                  <div
                    className={`bg-red-500 rounded-t-[4px] ${worked > 0 ? "mb-0.5" : ""}`}
                    style={{ height: `${(b.errors / highest) * 100}%` }}
                  />
                )}
                {worked > 0 && (
                  <div
                    className={`bg-primary-500 group-hover:bg-primary-600 ${b.errors > 0 ? "" : "rounded-t-[4px]"}`}
                    style={{ height: `${(worked / highest) * 100}%` }}
                  />
                )}
                <div
                  className={`pointer-events-none absolute bottom-full ${align} z-10 mb-1 hidden whitespace-nowrap rounded-md bg-secondary-900 px-2 py-1 text-xs text-white shadow group-hover:block`}
                >
                  <div className="font-semibold">{b.label}</div>
                  <div>
                    {count(b.calls)} {b.calls === 1 ? "call" : "calls"}
                    {b.errors > 0 && `, ${count(b.errors)} failed`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between pl-8 text-xs text-secondary-400">
        <span>{bars[0]?.label}</span>
        <span>{bars[bars.length - 1]?.label}</span>
      </div>
    </figure>
  );
}
