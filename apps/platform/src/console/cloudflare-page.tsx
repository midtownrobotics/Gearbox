// SPDX-License-Identifier: AGPL-3.0-only
import { Card, ErrorBanner, Page, PageLoading, ProgressBar, Stat, focusRing } from "@g3/ui";
import type {
  CloudflareOverview,
  Meter,
  Section,
  Warning,
  ZoneUsage,
} from "@g3/worker-platform/cloudflare";
import { type ReactNode, useState } from "react";
import { consoleApi, formatBytes, formatTime, read, useLoad } from "./data";

// The Cloudflare account: this billing period's usage against the plan, an estimated bill, warnings near a
// limit, each zone's traffic and security events, and each worker's deploys
// (workers/platform/src/cloudflare.ts). Operators only; the API token stays on the worker.

type Overview = Extract<CloudflareOverview, { configured: true }>;

const number = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
/** Under 1% shows as "<1%", so a meter in use never reads 0%. */
const percent = (share: number) =>
  share > 0 && share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`;
/** Where the worker's warnings start (WARN_AT). */
const WARN_SHARE = 0.8;

/** A day of the billing period, which Cloudflare gives in UTC. */
const day = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });

function amount(value: number, unit: Meter["unit"]): string {
  if (unit === "bytes") return formatBytes(value);
  if (unit === "ms") return `${number(value)} ms`;
  if (unit === "gbSeconds") return `${number(value)} GB-s`;
  return number(value);
}

export function CloudflarePage() {
  const load = useLoad(() => read<CloudflareOverview>(consoleApi.cloudflare.$get()), []);
  const data = load.data;

  return (
    <Page
      title="Cloudflare"
      description="What the account uses this billing period against its plan, and what it may cost."
    >
      {load.error && <ErrorBanner message={load.error} />}
      {!data ? (
        !load.error && <PageLoading />
      ) : !data.configured ? (
        <Card>
          <p className="text-sm text-secondary-600">
            Add a read-only Cloudflare API token and the account's ID to the platform worker to see
            this page. The steps are in docs/deploy.md, under "Console: Cloudflare".
          </p>
        </Card>
      ) : (
        <Overview data={data} />
      )}
    </Page>
  );
}

function Overview({ data }: { data: Overview }) {
  return (
    <>
      <p className="text-xs text-secondary-500">
        <span className="font-semibold text-secondary-700">
          {day(data.period.start)} – {day(data.period.end)}
        </span>
        {data.period.billing
          ? ". "
          : " (UTC). The token can't read the billing period, so this is the calendar month. "}
        As of {formatTime(data.asOf)}. Refreshed at most every 5 minutes.
      </p>
      {data.warnings.length > 0 && <Warnings warnings={data.warnings} />}
      <Card title="Estimated bill this month">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Estimate" value={money(data.estimate.total)} />
          <Stat label={data.plan} value={money(data.estimate.base)} hint="Each month" />
          <Stat label="Beyond the plan" value={money(data.estimate.overage)} />
        </div>
        <p className="mt-3 text-xs text-secondary-500">
          Worked out from Cloudflare's published prices, so the invoice may differ.
          {data.estimate.missing.length > 0 &&
            " It leaves out the parts below that Cloudflare didn't answer for."}
        </p>
      </Card>
      <Card title="Usage against the plan">
        <Meters meters={data.meters} />
      </Card>
      <Part title="Workers" section={data.workers}>
        {(rows) => (
          <Table
            rows={rows}
            columns={[
              { label: "Worker", sort: (w) => w.name },
              { label: "Requests", sort: (w) => w.requests, cell: (w) => number(w.requests) },
              {
                label: "Errors",
                sort: (w) => w.errors,
                cell: (w) => (
                  <span className={w.errors > 0 ? "text-red-700" : undefined}>
                    {number(w.errors)}
                  </span>
                ),
              },
              {
                label: "Subrequests",
                sort: (w) => w.subrequests,
                cell: (w) => number(w.subrequests),
              },
              {
                label: "CPU time",
                sort: (w) => w.cpuMs ?? -1,
                cell: (w) => (w.cpuMs === null ? "—" : `${number(w.cpuMs)} ms`),
              },
            ]}
          />
        )}
      </Part>
      <Part title="D1 databases" section={data.d1}>
        {(rows) => (
          <Table
            rows={rows}
            columns={[
              { label: "Database", sort: (d) => d.name },
              { label: "Rows read", sort: (d) => d.rowsRead, cell: (d) => number(d.rowsRead) },
              {
                label: "Rows written",
                sort: (d) => d.rowsWritten,
                cell: (d) => number(d.rowsWritten),
              },
              { label: "Size", sort: (d) => d.bytes, cell: (d) => formatBytes(d.bytes) },
            ]}
          />
        )}
      </Part>
      <Part title="R2 buckets" section={data.r2}>
        {(rows) => (
          <Table
            rows={rows}
            columns={[
              {
                label: "Bucket",
                sort: (b) => b.name,
                // Listing the account's buckets is in no bucket, but counts toward Class A.
                cell: (b) =>
                  b.name || (
                    <span className="font-normal italic text-secondary-500">Listing buckets</span>
                  ),
              },
              { label: "Stored", sort: (b) => b.bytes, cell: (b) => formatBytes(b.bytes) },
              { label: "Objects", sort: (b) => b.objects, cell: (b) => number(b.objects) },
              { label: "Class A", sort: (b) => b.classA, cell: (b) => number(b.classA) },
              { label: "Class B", sort: (b) => b.classB, cell: (b) => number(b.classB) },
            ]}
          />
        )}
      </Part>
      <Part title="KV namespaces" section={data.kv}>
        {(rows) => (
          <Table
            rows={rows}
            columns={[
              { label: "Namespace", sort: (n) => n.name },
              { label: "Reads", sort: (n) => n.reads, cell: (n) => number(n.reads) },
              { label: "Writes", sort: (n) => n.writes, cell: (n) => number(n.writes) },
              { label: "Deletes", sort: (n) => n.deletes, cell: (n) => number(n.deletes) },
              { label: "Lists", sort: (n) => n.lists, cell: (n) => number(n.lists) },
              { label: "Stored", sort: (n) => n.bytes, cell: (n) => formatBytes(n.bytes) },
              { label: "Keys", sort: (n) => n.keys, cell: (n) => number(n.keys) },
            ]}
          />
        )}
      </Part>
      <div className="grid gap-4 md:grid-cols-3">
        <Part title="Durable Objects" section={data.durableObjects}>
          {(d) => (
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Requests" value={number(d.requests)} />
              <Stat
                label="Duration"
                value={d.gbSeconds === null ? "—" : `${number(d.gbSeconds)} GB-s`}
              />
              <Stat label="Stored" value={formatBytes(d.storedBytes)} />
            </div>
          )}
        </Part>
        <Part title="Queues" section={data.queues}>
          {(q) => <Stat label="Operations" value={number(q.operations)} />}
        </Part>
        <Part title="Workers AI" section={data.ai}>
          {(a) => (
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Neurons today" value={number(a.today)} hint="10,000 free a day" />
              <Stat label="This period" value={number(a.month)} />
            </div>
          )}
        </Part>
      </div>
      <Part title="Zones" section={data.zones}>
        {(zones) => (
          <div className="space-y-4">
            {zones.map((zone) => (
              <Zone key={zone.name} zone={zone} />
            ))}
            {zones.length === 0 && <p className="text-sm text-secondary-500">No zones.</p>}
          </div>
        )}
      </Part>
      <Part title="Deploys" section={data.deploys}>
        {(workers) => (
          <Table
            rows={workers.map((w) => ({ ...w, last: w.deploys[0] }))}
            columns={[
              { label: "Worker", sort: (w) => w.name },
              {
                label: "Last deployed",
                sort: (w) => w.last?.createdAt ?? w.modifiedAt ?? 0,
                cell: (w) => formatTime(w.last?.createdAt ?? w.modifiedAt),
              },
              {
                label: "From",
                sort: (w) => w.last?.source ?? "",
                cell: (w) => w.last?.source || "—",
              },
              {
                label: "Message",
                sort: (w) => w.last?.message ?? "",
                cell: (w) => (
                  <span className="block max-w-xs truncate" title={w.last?.message ?? ""}>
                    {w.last?.message || "—"}
                  </span>
                ),
              },
              {
                label: "Versions",
                sort: (w) => w.last?.versions[0] ?? "",
                cell: (w) =>
                  w.last?.versions.length ? (
                    <ul>
                      {w.last.versions.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
        )}
      </Part>
    </>
  );
}

function Warnings({ warnings }: { warnings: Warning[] }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">Near the plan's limits</p>
      <ul className="mt-1 space-y-0.5">
        {warnings.map((w) => (
          <li key={w.label}>
            {w.label}: {amount(w.used, w.unit)} of {amount(w.limit, w.unit)} (
            {Math.round((w.used / w.limit) * 100)}%)
          </li>
        ))}
      </ul>
    </div>
  );
}

function Meters({ meters }: { meters: Meter[] }) {
  return (
    <ul className="space-y-3 text-sm">
      {meters.map((m) => {
        const share = m.included ? m.used / m.included : 0;
        return (
          <li
            key={m.key}
            className="grid gap-1 sm:grid-cols-[14rem_1fr_3.5rem_16rem] sm:items-center sm:gap-3"
          >
            <span className="min-w-0 text-secondary-600">
              {m.product}: {m.label}
            </span>
            <ProgressBar percent={Math.min(100, share * 100)} />
            <span
              className={`sm:text-right ${share >= 1 ? "text-red-700" : share >= WARN_SHARE ? "text-amber-700" : "text-secondary-600"}`}
            >
              {percent(share)}
            </span>
            <span className={`sm:text-right ${share >= 1 ? "text-red-700" : "text-secondary-900"}`}>
              {amount(m.used, m.unit)}{" "}
              <span className="text-secondary-500">
                of {amount(m.included, m.unit)}
                {m.period === "day" ? " a day" : ""}
                {m.cost > 0 && ` · ${money(m.cost)}`}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Zone({ zone }: { zone: ZoneUsage }) {
  return (
    <div className="min-w-0 rounded-xl border border-line p-4">
      <h3 className="text-lg font-semibold text-secondary-900">
        {zone.name}
        {zone.plan && (
          <span className="ml-2 text-xs font-normal text-secondary-500">{zone.plan}</span>
        )}
      </h3>
      {zone.traffic.ok ? (
        <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Requests" value={number(zone.traffic.data.requests)} hint="This period" />
          <Stat
            label="Cached"
            value={`${zone.traffic.data.requests ? Math.round((zone.traffic.data.cachedRequests / zone.traffic.data.requests) * 100) : 0}%`}
          />
          <Stat label="Bandwidth" value={formatBytes(zone.traffic.data.bytes)} />
          <Stat label="Threats" value={number(zone.traffic.data.threats)} />
          <Tally
            title="Status"
            rows={Object.entries(zone.traffic.data.statuses).map(([name, count]) => ({
              name,
              count,
              danger: name === "5xx" && count > 0,
            }))}
          />
          <Tally
            title="Top countries"
            rows={zone.traffic.data.countries.map((c) => ({ name: c.name, count: c.requests }))}
          />
        </div>
      ) : (
        <ErrorBanner message={zone.traffic.error} />
      )}
      <h4 className="mt-4 border-t border-line pt-4 text-xs font-bold uppercase tracking-widest text-secondary-400">
        Security events, last 24 hours
      </h4>
      {zone.security.ok ? (
        zone.security.data.total === 0 ? (
          <p className="mt-1 text-sm text-secondary-500">None.</p>
        ) : (
          <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {zone.security.data.capped && (
              <p className="text-xs text-secondary-500 sm:col-span-2 lg:col-span-4">
                Counts the latest {number(zone.security.data.total)} events only.
              </p>
            )}
            <Tally
              title={`By action (${number(zone.security.data.total)}${zone.security.data.capped ? "+" : ""})`}
              rows={zone.security.data.byAction}
            />
            <Tally title="By source" rows={zone.security.data.bySource} />
            <Tally title="Top paths" rows={zone.security.data.paths} />
            <Tally title="Top countries" rows={zone.security.data.countries} />
          </div>
        )
      ) : (
        <ErrorBanner message={zone.security.error} />
      )}
    </div>
  );
}

function Tally({
  title,
  rows,
}: { title: string; rows: { name: string; count: number; danger?: boolean }[] }) {
  return (
    <div className="min-w-0 rounded-lg border border-line p-3 text-sm">
      <p className="text-secondary-500">{title}</p>
      <ul>
        {rows.map((r) => (
          <li key={r.name} className="flex justify-between gap-2">
            <span className="truncate text-secondary-900" title={r.name}>
              {r.name || "—"}
            </span>
            <span className={r.danger ? "text-red-700" : "text-secondary-600"}>
              {number(r.count)}
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="text-secondary-500">—</li>}
      </ul>
    </div>
  );
}

/** A part of the page, or why Cloudflare didn't give it. */
function Part<T>({
  title,
  section,
  children,
}: { title: string; section: Section<T>; children: (data: T) => ReactNode }) {
  return (
    <Card title={title}>
      {section.ok ? children(section.data) : <ErrorBanner message={section.error} />}
    </Card>
  );
}

type Column<R> = {
  label: string;
  /** What the column sorts by. */
  sort: (row: R) => string | number;
  /** Shown in the cell; the sort value when left out. */
  cell?: (row: R) => ReactNode;
};

/** A table whose columns sort when their heading is clicked; the first column is the row's name. */
function Table<R>({ rows, columns }: { rows: R[]; columns: Column<R>[] }) {
  // Unsorted keeps the worker's order, by name.
  const [order, setOrder] = useState<{ column: number; descending: boolean } | null>(null);
  if (rows.length === 0) return <p className="text-sm text-secondary-500">None.</p>;

  const sorted = order ? [...rows] : rows;
  if (order) {
    const value = columns[order.column].sort;
    sorted.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const c =
        typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return order.descending ? -c : c;
    });
  }

  const sortBy = (column: number) =>
    setOrder((o) =>
      o?.column === column
        ? { column, descending: !o.descending }
        : // Numbers start biggest first, names A to Z.
          { column, descending: typeof columns[column].sort(rows[0]) === "number" },
    );

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-secondary-200 text-xs font-bold uppercase tracking-wider text-secondary-400">
            {columns.map((col, j) => (
              <th
                key={col.label}
                aria-sort={
                  order?.column === j ? (order.descending ? "descending" : "ascending") : undefined
                }
                className="py-2 pr-4 whitespace-nowrap"
              >
                <button
                  type="button"
                  onClick={() => sortBy(j)}
                  className={`inline-flex items-center gap-1 rounded uppercase hover:text-secondary-700 ${focusRing}`}
                >
                  {col.label}
                  <span aria-hidden className="w-2">
                    {order?.column === j ? (order.descending ? "▼" : "▲") : ""}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={String(columns[0].sort(row))} className="border-t border-line first:border-0">
              {columns.map((col, j) => (
                <td
                  key={col.label}
                  className={`py-2 pr-4 ${j === 0 ? "font-semibold text-secondary-900" : "text-secondary-600 whitespace-nowrap"}`}
                >
                  {col.cell ? col.cell(row) : col.sort(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
