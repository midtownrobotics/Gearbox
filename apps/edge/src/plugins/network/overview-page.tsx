import { useTeamNames } from "@g3/ui";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import {
  GB,
  formatBytes,
  formatDate,
  formatDayKey,
  formatHour,
  formatHourRange,
  todayKey,
} from "../../shared/format";
import { Card, ErrorBanner, Loading, Page, Stat } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { BarChart, ChartLegend } from "./bar-chart";
import { InsightStats, WhenCharts } from "./insights";
import { RangePicker, rangeLabel, useRange } from "./range";

async function loadOverview(query: { from: string | undefined; to: string | undefined }) {
  const res = await api.network.overview.$get({ query });
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

export function OverviewPage() {
  const names = useTeamNames();
  const { query, zoom, withRange } = useRange();
  const { data, error, reload } = useLoad(() => loadOverview(query), [query.from, query.to]);
  if (error)
    return (
      <Page title="Network">
        <RangePicker range={null} />
        <ErrorBanner message={error} />
      </Page>
    );
  if (!data)
    return (
      <Page title="Network">
        <Loading />
      </Page>
    );

  const { capBytes, used, projection, cycle, daily, range, stats } = data;
  const worst = Math.max(projection.runRate ?? 0, projection.sevenDayPace ?? 0);
  const today = todayKey();
  const label = rangeLabel(range);
  const total = data.rangeUsed;

  return (
    <Page title="Network">
      <RangePicker range={range} />
      <Card title={`Billing cycle · ${formatDate(cycle.start)} – ${formatDate(cycle.end - 1)}`}>
        {/* 0: the team hasn't set a cap (an admin sets it below). */}
        {capBytes > 0 && <UsageBar used={used} cap={capBytes} projected={worst || null} />}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
          <Stat
            label="Used"
            value={formatBytes(used)}
            hint={capBytes > 0 ? `of ${formatBytes(capBytes)} cap` : "no cap set"}
          />
          {capBytes > 0 && (
            <Stat label="Remaining" value={formatBytes(Math.max(0, capBytes - used))} />
          )}
          <Projection label="Projected (cycle pace)" value={projection.runRate} cap={capBytes} />
          <Projection
            label="Projected (last 7 days)"
            value={projection.sevenDayPace}
            cap={capBytes}
          />
        </div>
        <SettingsRow capBytes={capBytes} onSaved={reload} />
      </Card>

      <Card title={`Usage · ${label}`}>
        <InsightStats stats={stats} onDay={zoom} totalLabel="Used" />
        <div className="mt-5">
          {stats.singleDay ? (
            <BarChart
              label="Usage by hour"
              bars={data.hourly.map((h) => ({
                label: formatHourRange(h.hour),
                tick: formatHour(h.hour),
                dl: h.dl,
                ul: h.ul,
              }))}
            />
          ) : (
            <BarChart
              label="Usage by day: choose a day to see its hours"
              bars={daily.map((d) => ({
                label: formatDayKey(d.day),
                tick: String(Number(d.day.slice(8))),
                dl: d.day <= today ? d.dl : 0,
                ul: d.day <= today ? d.ul : 0,
              }))}
              onSelect={(i) => zoom(daily[i].day)}
              reference={
                capBytes > 0 && range.isCycle
                  ? { value: capBytes / daily.length, label: "even pace" }
                  : stats.perDay > 0
                    ? { value: stats.perDay, label: "average" }
                    : undefined
              }
            />
          )}
          <ChartLegend />
          {!stats.singleDay && (
            <p className="mt-1 text-xs text-secondary-500">Choose a day to see its hours.</p>
          )}
        </div>
      </Card>

      <Card title="When it's used">
        <WhenCharts stats={stats} />
      </Card>

      <Card title={`Top devices · ${label}`}>
        {data.topClients.length === 0 ? (
          <p className="text-sm text-secondary-400">No usage recorded yet.</p>
        ) : (
          <ul className="divide-y divide-secondary-100">
            {data.topClients.map((c) => (
              <li key={c.mac} className="py-2 flex items-center gap-3">
                <Link
                  to={withRange(`/network/clients/${encodeURIComponent(c.mac)}`)}
                  className="text-secondary-900 hover:text-primary-500 font-medium truncate"
                >
                  {c.name}
                </Link>
                <ShareBar share={(c.dl + c.ul) / Math.max(1, total)} />
                <span className="text-sm text-secondary-600 tabular-nums w-20 text-right">
                  {formatBytes(c.dl + c.ul)}
                </span>
              </li>
            ))}
            <li
              className="py-2 flex items-center gap-3 text-secondary-500"
              title={`Product pages fetched for ${names.appTitle("Orders")} part lookups.`}
            >
              <span className="italic">Part lookups ({names.appTitle("Orders")})</span>
              <ShareBar share={(data.lookups.dl + data.lookups.ul) / Math.max(1, total)} />
              <span className="text-sm tabular-nums w-20 text-right">
                {formatBytes(data.lookups.dl + data.lookups.ul)}
              </span>
            </li>
            <li
              className="py-2 flex items-center gap-3 text-secondary-500"
              title="Traffic from the box itself and network overhead."
            >
              <span className="italic">Edge box &amp; overhead</span>
              <ShareBar share={data.unattributed / Math.max(1, total)} />
              <span className="text-sm tabular-nums w-20 text-right">
                {formatBytes(data.unattributed)}
              </span>
            </li>
          </ul>
        )}
      </Card>
    </Page>
  );
}

function UsageBar({
  used,
  cap,
  projected,
}: { used: number; cap: number; projected: number | null }) {
  const pct = (v: number) => `${Math.min(100, (v / cap) * 100)}%`;
  const over = projected !== null && projected > cap;
  return (
    <div className="relative h-4 rounded-full bg-secondary-100 overflow-hidden">
      {projected !== null && (
        <div
          className={`absolute inset-y-0 left-0 ${over ? "bg-primary-100" : "bg-secondary-200"}`}
          style={{ width: pct(projected) }}
        />
      )}
      <div
        className="absolute inset-y-0 left-0 bg-primary-500 rounded-full"
        style={{ width: pct(used) }}
      />
    </div>
  );
}

function Projection({ label, value, cap }: { label: string; value: number | null; cap: number }) {
  if (value === null) return <Stat label={label} value="—" hint="Not enough data yet" />;
  if (cap === 0) return <Stat label={label} value={formatBytes(value)} />;
  const over = value > cap;
  return (
    <Stat
      label={label}
      value={<span className={over ? "text-primary-600" : undefined}>{formatBytes(value)}</span>}
      hint={over ? `${formatBytes(value - cap)} over cap` : "under cap"}
    />
  );
}

function ShareBar({ share }: { share: number }) {
  return (
    <div className="flex-1 h-1.5 rounded-full bg-secondary-100 min-w-12">
      <div
        className="h-full rounded-full bg-primary-300"
        style={{ width: `${Math.min(100, share * 100)}%` }}
      />
    </div>
  );
}

/** Admin-only: set the data cap and billing-cycle start day. */
function SettingsRow({ capBytes, onSaved }: { capBytes: number; onSaved: () => void }) {
  const user = useAuthUser();
  const settings = useLoad(async () => {
    const res = await api.network.settings.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, [capBytes]);
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState("");
  const [day, setDay] = useState("");
  const [error, setError] = useState<string | null>(null);

  const s = settings.data;
  if (!s) return null;

  async function save() {
    setError(null);
    const res = await api.network.settings.$patch({
      json: { capBytes: Math.round(Number(cap) * GB), cycleStartDay: Number(day) },
    });
    if (!res.ok) return setError(await getErrorMessage(res));
    setEditing(false);
    onSaved();
  }

  if (!editing) {
    return (
      <p className="text-xs text-secondary-400 mt-4">
        {s.capBytes > 0 ? `Cap ${formatBytes(s.capBytes)}` : "No data cap set"} · cycle resets on
        day {s.cycleStartDay} of each month
        {user.isAdmin && (
          <button
            type="button"
            className="ml-2 text-primary-500 hover:text-primary-700 font-medium"
            onClick={() => {
              setCap(String(s.capBytes / GB));
              setDay(String(s.cycleStartDay));
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </p>
    );
  }

  const input = "border border-secondary-300 rounded-lg px-2 py-1 w-20 text-sm";
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-secondary-600">
      <label className="flex items-center gap-1.5">
        Cap{" "}
        <input
          className={input}
          type="number"
          min="1"
          step="0.1"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
        />{" "}
        GB
      </label>
      <label className="flex items-center gap-1.5">
        Resets on day{" "}
        <input
          className={input}
          type="number"
          min="1"
          max="31"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
      </label>
      <button
        type="button"
        onClick={save}
        className="bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-lg px-3 py-1"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-secondary-500 hover:text-secondary-900"
      >
        Cancel
      </button>
      {error && <span className="text-primary-600">{error}</span>}
    </div>
  );
}
