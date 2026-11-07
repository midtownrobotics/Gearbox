// SPDX-License-Identifier: AGPL-3.0-only
import { Card, ErrorBanner, Page, PageLoading, ProgressBar, Stat } from "@g3/ui";
import type {
  CloudflareOverview,
  Meter,
  Section,
  Warning,
  ZoneUsage,
} from "@g3/worker-platform/cloudflare";
import type { ReactNode } from "react";
import { consoleApi, formatBytes, formatTime, read, useLoad } from "./data";

// The Cloudflare account: this month's usage against the plan, an estimated bill, warnings near a
// limit, each zone's traffic and security events, and each worker's deploys
// (workers/platform/src/cloudflare.ts). Operators only; the API token stays on the worker.

type Overview = Extract<CloudflareOverview, { configured: true }>;

const number = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
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
      description="What the account uses this month (UTC) against its plan, and what it may cost."
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
            ` It leaves out ${data.estimate.missing.join(", ")}, which Cloudflare didn't answer for.`}
        </p>
      </Card>
      <Card title="Usage against the plan">
        <Meters meters={data.meters} />
      </Card>
      <Part title="Workers" section={data.workers}>
        {(rows) => (
          <Table
            head={["Worker", "Requests", "Errors", "Subrequests", "CPU time"]}
            rows={rows.map((w) => [
              w.name,
              number(w.requests),
              <span key="e" className={w.errors > 0 ? "text-red-700" : undefined}>
                {number(w.errors)}
              </span>,
              number(w.subrequests),
              w.cpuMs === null ? "—" : `${number(w.cpuMs)} ms`,
            ])}
          />
        )}
      </Part>
      <Part title="D1 databases" section={data.d1}>
        {(rows) => (
          <Table
            head={["Database", "Rows read", "Rows written", "Size"]}
            rows={rows.map((d) => [
              d.name,
              number(d.rowsRead),
              number(d.rowsWritten),
              formatBytes(d.bytes),
            ])}
          />
        )}
      </Part>
      <Part title="R2 buckets" section={data.r2}>
        {(rows) => (
          <Table
            head={["Bucket", "Stored", "Objects", "Class A", "Class B"]}
            rows={rows.map((b) => [
              b.name,
              formatBytes(b.bytes),
              number(b.objects),
              number(b.classA),
              number(b.classB),
            ])}
          />
        )}
      </Part>
      <Part title="KV namespaces" section={data.kv}>
        {(rows) => (
          <Table
            head={["Namespace", "Reads", "Writes", "Deletes", "Lists", "Stored", "Keys"]}
            rows={rows.map((n) => [
              n.name,
              number(n.reads),
              number(n.writes),
              number(n.deletes),
              number(n.lists),
              formatBytes(n.bytes),
              number(n.keys),
            ])}
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
              <Stat label="This month" value={number(a.month)} />
            </div>
          )}
        </Part>
      </div>
      <Part title="Zones" section={data.zones}>
        {(zones) => (
          <div className="space-y-6">
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
            head={["Worker", "Last deployed", "From", "Message", "Versions"]}
            rows={workers.map((w) => {
              const last = w.deploys[0];
              return [
                w.name,
                formatTime(last?.createdAt ?? w.modifiedAt),
                last?.source || "—",
                <span key="m" className="block max-w-xs truncate" title={last?.message ?? ""}>
                  {last?.message || "—"}
                </span>,
                last?.versions.join(", ") || "—",
              ];
            })}
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
            className="grid gap-1 sm:grid-cols-[14rem_1fr_16rem] sm:items-center sm:gap-3"
          >
            <span className="min-w-0 text-secondary-600">
              {m.product}: {m.label}
            </span>
            <ProgressBar percent={Math.min(100, share * 100)} />
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
    <div className="min-w-0">
      <h3 className="font-semibold text-secondary-900">
        {zone.name}
        {zone.plan && (
          <span className="ml-2 text-xs font-normal text-secondary-500">{zone.plan}</span>
        )}
      </h3>
      {zone.traffic.ok ? (
        <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Requests" value={number(zone.traffic.data.requests)} hint="This month" />
          <Stat
            label="Cached"
            value={`${zone.traffic.data.requests ? Math.round((zone.traffic.data.cachedRequests / zone.traffic.data.requests) * 100) : 0}%`}
          />
          <Stat label="Bandwidth" value={formatBytes(zone.traffic.data.bytes)} />
          <Stat label="Threats" value={number(zone.traffic.data.threats)} />
          <Stat
            label="Status"
            value={
              <span className="text-sm">
                {Object.entries(zone.traffic.data.statuses).map(([group, n]) => (
                  <span
                    key={group}
                    className={`mr-3 ${group === "5xx" && n > 0 ? "text-red-700" : ""}`}
                  >
                    {group} {number(n)}
                  </span>
                ))}
              </span>
            }
          />
          <Stat
            label="Top countries"
            value={
              <span className="text-sm">
                {zone.traffic.data.countries
                  .map((c) => `${c.name} ${number(c.requests)}`)
                  .join(", ") || "—"}
              </span>
            }
          />
        </div>
      ) : (
        <ErrorBanner message={zone.traffic.error} />
      )}
      <h4 className="mt-4 text-xs font-bold uppercase tracking-widest text-secondary-400">
        Security events, last 24 hours
      </h4>
      {zone.security.ok ? (
        zone.security.data.total === 0 ? (
          <p className="mt-1 text-sm text-secondary-500">None.</p>
        ) : (
          <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tally
              title={`By action (${number(zone.security.data.total)})`}
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

function Tally({ title, rows }: { title: string; rows: { name: string; count: number }[] }) {
  return (
    <div className="min-w-0 text-sm">
      <p className="text-secondary-500">{title}</p>
      <ul>
        {rows.map((r) => (
          <li key={r.name} className="flex justify-between gap-2">
            <span className="truncate text-secondary-900" title={r.name}>
              {r.name || "—"}
            </span>
            <span className="text-secondary-600">{number(r.count)}</span>
          </li>
        ))}
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

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (rows.length === 0) return <p className="text-sm text-secondary-500">None.</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-secondary-200 text-xs font-bold uppercase tracking-wider text-secondary-400">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id, and never reorder.
            <tr key={i} className="border-t border-line first:border-0">
              {cells.map((cell, j) => (
                <td
                  key={head[j]}
                  className={`py-2 pr-4 ${j === 0 ? "font-semibold text-secondary-900" : "text-secondary-600 whitespace-nowrap"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
