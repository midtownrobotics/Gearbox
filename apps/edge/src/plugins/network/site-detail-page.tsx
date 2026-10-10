import { Link, useParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { formatBytes, formatDayKey } from "../../shared/format";
import { Card, ErrorBanner, Loading, Page } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { BarChart, ChartLegend } from "./bar-chart";
import { InsightStats, WhenCharts } from "./insights";
import { RangePicker, rangeLabel, useRange } from "./range";

export function SiteDetailPage() {
  const site = useParams().site ?? "";
  const { query, zoom, withRange } = useRange();
  const { data, error } = useLoad(async () => {
    const res = await api.network.sites.site[":site"].$get({ param: { site }, query });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, [site, query.from, query.to]);

  const back = (
    <Link
      to={withRange("/network/sites")}
      className="text-sm text-secondary-500 hover:text-secondary-900"
    >
      ← All sites
    </Link>
  );
  if (error)
    return (
      <Page title={site} actions={back}>
        <ErrorBanner message={error} />
      </Page>
    );
  if (!data)
    return (
      <Page title={site} actions={back}>
        <Loading />
      </Page>
    );

  const { range, stats, daily } = data;
  const label = rangeLabel(range);
  return (
    <Page title={site} actions={back}>
      <RangePicker range={range} />
      <Card title={`Usage · ${label}`}>
        <InsightStats stats={stats} onDay={zoom} />
        <p className="mt-3 text-sm text-secondary-600">
          {data.clients.length} {data.clients.length === 1 ? "device" : "devices"} used it.
        </p>
        {!stats.singleDay && (
          <div className="mt-5">
            <BarChart
              label="Usage by day: choose a day to see that day's devices"
              bars={daily.map((d) => ({
                label: formatDayKey(d.day),
                tick: String(Number(d.day.slice(8))),
                dl: d.dl,
                ul: d.ul,
              }))}
              onSelect={(i) => zoom(daily[i].day)}
              reference={stats.perDay > 0 ? { value: stats.perDay, label: "average" } : undefined}
            />
            <ChartLegend />
            <p className="mt-1 text-xs text-secondary-500">
              Choose a day to see which devices used it that day.
            </p>
          </div>
        )}
      </Card>

      {!stats.singleDay && (
        <Card title="When it's used">
          <WhenCharts stats={stats} />
        </Card>
      )}

      <Card title={`Devices · ${label}`}>
        <ul className="divide-y divide-secondary-100">
          {data.clients.map((c) => (
            <li key={c.mac} className="py-2 flex items-center justify-between gap-3">
              <Link
                to={withRange(`/network/clients/${encodeURIComponent(c.mac)}`)}
                className="text-secondary-900 hover:text-primary-500 font-medium truncate"
              >
                {c.name}
              </Link>
              <span className="text-sm text-secondary-600 tabular-nums">
                {formatBytes(c.dl + c.ul)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
