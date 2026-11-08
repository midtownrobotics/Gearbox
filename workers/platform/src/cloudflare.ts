// SPDX-License-Identifier: AGPL-3.0-only
import type { AppEnv } from "./types";

// The console's Cloudflare page (GET /console/cloudflare): what the account uses this month (UTC)
// against what Workers Paid includes, an estimate of the bill from Cloudflare's published prices,
// warnings at 80% of an included amount, each zone's traffic and security events, and each
// worker's deploys. It reads Cloudflare's API with a read-only token (secrets CLOUDFLARE_API_TOKEN
// and CLOUDFLARE_ACCOUNT_ID; docs/deploy.md, "Console: Cloudflare"), which never leaves this
// worker. Only operators reach it (src/console.ts), and nothing they send goes into a request to
// Cloudflare: every query is built here from the account's own ids and the date.
//
// Each part is its own request, so one Cloudflare can't answer (a dataset the token can't read, a
// field it renamed) leaves the rest. Results are kept for 5 minutes in the isolate, so opening the
// page often doesn't spend the API's rate limit. Billing and Workers Logs are deliberately left
// out: invoices aren't needed for the estimate, and log lines can hold members' requests.

type Env = AppEnv["Bindings"];

const API = "https://api.cloudflare.com/client/v4";
const KEPT_MS = 5 * 60 * 1000;

/** A part of the page: its data, or why it's missing (shown to operators, never Cloudflare's text). */
export type Section<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Workers Paid: what each meter includes a month, and the price of each `per` units beyond it.
 * From developers.cloudflare.com's pricing pages (read 6 November 2026); update them here when
 * Cloudflare's change.
 */
export const PLAN = {
  name: "Workers Paid",
  base: 5,
  workersRequests: { included: 10e6, price: 0.3, per: 1e6 },
  workersCpuMs: { included: 30e6, price: 0.02, per: 1e6 },
  d1RowsRead: { included: 25e9, price: 0.001, per: 1e6 },
  d1RowsWritten: { included: 50e6, price: 1, per: 1e6 },
  d1Storage: { included: 5e9, price: 0.75, per: 1e9 },
  kvReads: { included: 10e6, price: 0.5, per: 1e6 },
  kvWrites: { included: 1e6, price: 5, per: 1e6 },
  kvDeletes: { included: 1e6, price: 5, per: 1e6 },
  kvLists: { included: 1e6, price: 5, per: 1e6 },
  kvStorage: { included: 1e9, price: 0.5, per: 1e9 },
  r2Storage: { included: 10e9, price: 0.015, per: 1e9 },
  r2ClassA: { included: 1e6, price: 4.5, per: 1e6 },
  r2ClassB: { included: 10e6, price: 0.36, per: 1e6 },
  doRequests: { included: 1e6, price: 0.15, per: 1e6 },
  doDuration: { included: 400_000, price: 12.5, per: 1e6 },
  doStorage: { included: 5e9, price: 0.2, per: 1e9 },
  queueOperations: { included: 1e6, price: 0.4, per: 1e6 },
  /** Per UTC day, not per month. */
  aiNeuronsDaily: { included: 10_000, price: 0.011, per: 1000 },
  /** Largest a D1 database may grow (a limit, not a price). */
  d1DatabaseMaxBytes: 10e9,
};

type Price = { included: number; price: number; per: number };

/** Warned about once a meter reaches this share of what's included. */
export const WARN_AT = 0.8;

export type Meter = {
  key: string;
  product: string;
  label: string;
  unit: "count" | "bytes" | "ms" | "gbSeconds";
  used: number;
  included: number;
  /** "month", or "day" for Workers AI's neurons (today's shown). */
  period: "month" | "day";
  /** Estimated cost beyond what's included, in USD. */
  cost: number;
};

export type Warning = { label: string; used: number; limit: number; unit: Meter["unit"] };

export type WorkerUsage = {
  name: string;
  requests: number;
  errors: number;
  subrequests: number;
  cpuMs: number | null;
};
export type DatabaseUsage = { name: string; rowsRead: number; rowsWritten: number; bytes: number };
export type BucketUsage = {
  name: string;
  bytes: number;
  objects: number;
  classA: number;
  classB: number;
};
export type NamespaceUsage = {
  name: string;
  reads: number;
  writes: number;
  deletes: number;
  lists: number;
  bytes: number;
  keys: number;
};
export type DurableObjectsUsage = {
  requests: number;
  /** Null when Cloudflare didn't answer for duration. */
  gbSeconds: number | null;
  storedBytes: number;
};
export type ZoneUsage = {
  name: string;
  plan: string;
  traffic: Section<{
    requests: number;
    cachedRequests: number;
    bytes: number;
    cachedBytes: number;
    threats: number;
    statuses: Record<"2xx" | "3xx" | "4xx" | "5xx", number>;
    countries: { name: string; requests: number }[];
  }>;
  /** The last 24 hours. */
  security: Section<{
    total: number;
    /** Only the latest events were counted: there were more. */
    capped: boolean;
    byAction: { name: string; count: number }[];
    bySource: { name: string; count: number }[];
    paths: { name: string; count: number }[];
    countries: { name: string; count: number }[];
  }>;
};
export type Deploy = {
  createdAt: number;
  source: string;
  message: string | null;
  versions: string[];
};
export type WorkerDeploys = { name: string; modifiedAt: number | null; deploys: Deploy[] };

export type CloudflareOverview =
  | { configured: false }
  | {
      configured: true;
      asOf: number;
      plan: string;
      period: { start: number; end: number };
      meters: Meter[];
      estimate: { base: number; overage: number; total: number; missing: string[] };
      warnings: Warning[];
      workers: Section<WorkerUsage[]>;
      d1: Section<DatabaseUsage[]>;
      r2: Section<BucketUsage[]>;
      kv: Section<NamespaceUsage[]>;
      durableObjects: Section<DurableObjectsUsage>;
      queues: Section<{ operations: number }>;
      ai: Section<{ today: number; month: number; days: { date: string; neurons: number }[] }>;
      zones: Section<ZoneUsage[]>;
      deploys: Section<WorkerDeploys[]>;
    };

class CloudflareError extends Error {}

const ACCOUNT_ID = /^[0-9a-f]{32}$/;

/** A GET on Cloudflare's REST API: its `result`. */
async function rest<T>(env: Env, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
  });
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    result?: T;
    errors?: unknown;
  } | null;
  if (!res.ok || !body?.success) {
    console.error(
      "[cloudflare] REST",
      path.split("?")[0],
      res.status,
      JSON.stringify(body?.errors),
    );
    throw new CloudflareError(`Cloudflare answered ${res.status}.`);
  }
  return body.result as T;
}

/** A GraphQL Analytics query: its `data.viewer`. */
async function graphql<T>(env: Env, query: string): Promise<T> {
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: { viewer?: T } | null;
    errors?: { message?: string }[] | null;
  } | null;
  if (!res.ok || body?.errors?.length || !body?.data?.viewer) {
    console.error("[cloudflare] GraphQL", res.status, JSON.stringify(body?.errors));
    throw new CloudflareError(`Cloudflare answered ${res.status}.`);
  }
  return body.data.viewer;
}

/** One dataset on the account, in its own query. */
async function accountDataset<T>(env: Env, dataset: string): Promise<T[]> {
  const viewer = await graphql<{ accounts: Record<string, T[]>[] }>(
    env,
    `{ viewer { accounts(filter: { accountTag: "${env.CLOUDFLARE_ACCOUNT_ID}" }) { ${dataset} } } }`,
  );
  const account = viewer.accounts[0];
  if (!account) throw new CloudflareError("The token can't read this account.");
  return Object.values(account)[0] ?? [];
}

/** Runs one part; a failure becomes its error, for the page. */
async function section<T>(load: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (err) {
    if (!(err instanceof CloudflareError)) console.error("[cloudflare]", err);
    return {
      ok: false,
      error: "Cloudflare didn't answer for this part. Check the token's permissions.",
    };
  }
}

type Period = { start: Date; end: Date; startDate: string; endDate: string };

/** This UTC month, up to now. */
function thisMonth(now: Date): Period {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { start, end: now, startDate: day(start), endDate: day(now) };
}

const between = (p: Period) =>
  `datetime_geq: "${p.start.toISOString()}", datetime_leq: "${p.end.toISOString()}"`;
const betweenDates = (p: Period) => `date_geq: "${p.startDate}", date_leq: "${p.endDate}"`;

const byName = <T extends { name: string }>(rows: T[]) =>
  rows.sort((a, b) => a.name.localeCompare(b.name));

async function workers(env: Env, p: Period): Promise<WorkerUsage[]> {
  type Row = {
    sum: { requests: number; errors: number; subrequests: number };
    dimensions: { scriptName: string };
  };
  type CpuRow = { sum: { cpuTimeUs: number }; dimensions: { scriptName: string } };
  const [rows, cpu] = await Promise.all([
    accountDataset<Row>(
      env,
      `workersInvocationsAdaptive(limit: 1000, filter: { ${between(p)} }) { sum { requests errors subrequests } dimensions { scriptName } }`,
    ),
    // Asked apart: a CPU field Cloudflare renames leaves the request counts.
    accountDataset<CpuRow>(
      env,
      `workersInvocationsAdaptive(limit: 1000, filter: { ${between(p)} }) { sum { cpuTimeUs } dimensions { scriptName } }`,
    ).catch(() => null),
  ]);
  const scripts = new Map<string, WorkerUsage>();
  for (const row of rows) {
    const name = row.dimensions.scriptName;
    const usage = scripts.get(name) ?? {
      name,
      requests: 0,
      errors: 0,
      subrequests: 0,
      cpuMs: null,
    };
    usage.requests += row.sum.requests;
    usage.errors += row.sum.errors;
    usage.subrequests += row.sum.subrequests;
    scripts.set(name, usage);
  }
  for (const row of cpu ?? []) {
    const usage = scripts.get(row.dimensions.scriptName);
    if (usage) usage.cpuMs = (usage.cpuMs ?? 0) + row.sum.cpuTimeUs / 1000;
  }
  return byName([...scripts.values()]);
}

async function d1(env: Env, p: Period): Promise<DatabaseUsage[]> {
  const account = `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
  type Use = { sum: { rowsRead: number; rowsWritten: number }; dimensions: { databaseId: string } };
  type Size = { max: { databaseSizeBytes: number }; dimensions: { databaseId: string } };
  const [list, use, size] = await Promise.all([
    rest<{ uuid: string; name: string }[]>(env, `${account}/d1/database?per_page=100`),
    accountDataset<Use>(
      env,
      `d1AnalyticsAdaptiveGroups(limit: 10000, filter: { ${betweenDates(p)} }) { sum { rowsRead rowsWritten } dimensions { databaseId } }`,
    ),
    accountDataset<Size>(
      env,
      `d1StorageAdaptiveGroups(limit: 10000, filter: { ${betweenDates(p)} }) { max { databaseSizeBytes } dimensions { databaseId } }`,
    ),
  ]);
  return byName(
    list.map((db) => {
      const mine = use.filter((r) => r.dimensions.databaseId === db.uuid);
      const sizes = size.filter((r) => r.dimensions.databaseId === db.uuid);
      return {
        name: db.name,
        rowsRead: mine.reduce((n, r) => n + r.sum.rowsRead, 0),
        rowsWritten: mine.reduce((n, r) => n + r.sum.rowsWritten, 0),
        bytes: Math.max(0, ...sizes.map((r) => r.max.databaseSizeBytes)),
      };
    }),
  );
}

/** R2's free operations; anything not here or in CLASS_A is Class B. */
const R2_FREE = new Set(["DeleteObject", "DeleteObjects", "DeleteBucket", "AbortMultipartUpload"]);
const R2_CLASS_A = new Set([
  "ListBuckets",
  "PutBucket",
  "ListObjects",
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "LifecycleStorageTierTransition",
  "ListMultipartUploads",
  "UploadPart",
  "UploadPartCopy",
  "ListParts",
  "PutBucketEncryption",
  "PutBucketCors",
  "PutBucketLifecycleConfiguration",
]);

async function r2(env: Env, p: Period): Promise<BucketUsage[]> {
  type Ops = { sum: { requests: number }; dimensions: { bucketName: string; actionType: string } };
  type Store = {
    max: { payloadSize: number; metadataSize: number; objectCount: number };
    dimensions: { bucketName: string };
  };
  const [ops, store] = await Promise.all([
    accountDataset<Ops>(
      env,
      `r2OperationsAdaptiveGroups(limit: 10000, filter: { ${between(p)} }) { sum { requests } dimensions { bucketName actionType } }`,
    ),
    accountDataset<Store>(
      env,
      `r2StorageAdaptiveGroups(limit: 10000, filter: { ${between(p)} }) { max { payloadSize metadataSize objectCount } dimensions { bucketName } }`,
    ),
  ]);
  const buckets = new Map<string, BucketUsage>();
  const bucket = (name: string) => {
    const found = buckets.get(name) ?? { name, bytes: 0, objects: 0, classA: 0, classB: 0 };
    buckets.set(name, found);
    return found;
  };
  for (const row of store) {
    const b = bucket(row.dimensions.bucketName);
    b.bytes = Math.max(b.bytes, row.max.payloadSize + row.max.metadataSize);
    b.objects = Math.max(b.objects, row.max.objectCount);
  }
  for (const row of ops) {
    const { actionType, bucketName } = row.dimensions;
    if (R2_FREE.has(actionType)) continue;
    const b = bucket(bucketName);
    if (R2_CLASS_A.has(actionType)) b.classA += row.sum.requests;
    else b.classB += row.sum.requests;
  }
  return byName([...buckets.values()]);
}

async function kv(env: Env, p: Period): Promise<NamespaceUsage[]> {
  const account = `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
  type Ops = { sum: { requests: number }; dimensions: { namespaceId: string; actionType: string } };
  type Store = {
    max: { byteCount: number; keyCount: number };
    dimensions: { namespaceId: string };
  };
  const [list, ops, store] = await Promise.all([
    rest<{ id: string; title: string }[]>(env, `${account}/storage/kv/namespaces?per_page=100`),
    accountDataset<Ops>(
      env,
      `kvOperationsAdaptiveGroups(limit: 10000, filter: { ${betweenDates(p)} }) { sum { requests } dimensions { namespaceId actionType } }`,
    ),
    accountDataset<Store>(
      env,
      `kvStorageAdaptiveGroups(limit: 10000, filter: { ${betweenDates(p)} }) { max { byteCount keyCount } dimensions { namespaceId } }`,
    ),
  ]);
  return byName(
    list.map((ns) => {
      const count = (action: string) =>
        ops
          .filter((r) => r.dimensions.namespaceId === ns.id && r.dimensions.actionType === action)
          .reduce((n, r) => n + r.sum.requests, 0);
      const sizes = store.filter((r) => r.dimensions.namespaceId === ns.id);
      return {
        name: ns.title,
        reads: count("read"),
        writes: count("write"),
        deletes: count("delete"),
        lists: count("list"),
        bytes: Math.max(0, ...sizes.map((r) => r.max.byteCount)),
        keys: Math.max(0, ...sizes.map((r) => r.max.keyCount)),
      };
    }),
  );
}

async function durableObjects(env: Env, p: Period): Promise<DurableObjectsUsage> {
  const [invocations, storage, periodic] = await Promise.all([
    accountDataset<{ sum: { requests: number } }>(
      env,
      `durableObjectsInvocationsAdaptiveGroups(limit: 1, filter: { ${betweenDates(p)} }) { sum { requests } }`,
    ),
    accountDataset<{ max: { storedBytes: number } }>(
      env,
      `durableObjectsStorageGroups(limit: 1, filter: { ${betweenDates(p)} }) { max { storedBytes } }`,
    ),
    accountDataset<{ sum: { activeTime: number } }>(
      env,
      `durableObjectsPeriodicGroups(limit: 1, filter: { ${betweenDates(p)} }) { sum { activeTime } }`,
    ).catch(() => null),
  ]);
  // Duration is billed at 128 MB for the time an object is active (activeTime, in microseconds).
  const activeUs = periodic?.reduce((n, r) => n + r.sum.activeTime, 0);
  return {
    requests: invocations.reduce((n, r) => n + r.sum.requests, 0),
    gbSeconds: activeUs === undefined ? null : (activeUs / 1e6) * 0.125,
    storedBytes: Math.max(0, ...storage.map((r) => r.max.storedBytes)),
  };
}

async function queues(env: Env, p: Period) {
  const rows = await accountDataset<{ sum: { billableOperations: number } }>(
    env,
    `queueMessageOperationsAdaptiveGroups(limit: 1, filter: { ${between(p)} }) { sum { billableOperations } }`,
  );
  return { operations: rows.reduce((n, r) => n + r.sum.billableOperations, 0) };
}

async function ai(env: Env, p: Period) {
  const rows = await accountDataset<{
    sum: { totalNeurons: number };
    dimensions: { date: string };
  }>(
    env,
    `aiInferenceAdaptiveGroups(limit: 100, filter: { ${between(p)} }) { sum { totalNeurons } dimensions { date } }`,
  );
  const days = new Map<string, number>();
  for (const row of rows) {
    days.set(row.dimensions.date, (days.get(row.dimensions.date) ?? 0) + row.sum.totalNeurons);
  }
  const list = [...days]
    .map(([date, neurons]) => ({ date, neurons }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    today: days.get(p.endDate) ?? 0,
    month: list.reduce((n, d) => n + d.neurons, 0),
    days: list,
  };
}

/** The top `n` of `counts`, most first. */
function top(counts: Map<string, number>, n: number) {
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

async function zoneTraffic(env: Env, zoneId: string, p: Period): Promise<ZoneUsage["traffic"]> {
  return section(async () => {
    type Day = {
      sum: {
        requests: number;
        cachedRequests: number;
        bytes: number;
        cachedBytes: number;
        threats: number;
        countryMap: { clientCountryName: string; requests: number }[];
        responseStatusMap: { edgeResponseStatus: number; requests: number }[];
      };
    };
    const viewer = await graphql<{ zones: { httpRequests1dGroups: Day[] }[] }>(
      env,
      `{ viewer { zones(filter: { zoneTag: "${zoneId}" }) { httpRequests1dGroups(limit: 31, filter: { ${betweenDates(p)} }) { sum { requests cachedRequests bytes cachedBytes threats countryMap { clientCountryName requests } responseStatusMap { edgeResponseStatus requests } } } } } }`,
    );
    const days = viewer.zones[0]?.httpRequests1dGroups ?? [];
    const statuses = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
    const countries = new Map<string, number>();
    const total = { requests: 0, cachedRequests: 0, bytes: 0, cachedBytes: 0, threats: 0 };
    for (const { sum } of days) {
      for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += sum[key];
      for (const s of sum.responseStatusMap) {
        const group = `${Math.floor(s.edgeResponseStatus / 100)}xx` as keyof typeof statuses;
        if (group in statuses) statuses[group] += s.requests;
      }
      for (const c of sum.countryMap) {
        countries.set(c.clientCountryName, (countries.get(c.clientCountryName) ?? 0) + c.requests);
      }
    }
    return {
      ...total,
      statuses,
      countries: top(countries, 5).map(({ name, count }) => ({ name, requests: count })),
    };
  });
}

// Single events, counted here: the grouped dataset isn't on the Free plan, this one is on all of them.
const SECURITY_EVENTS = 10_000;

async function zoneSecurity(env: Env, zoneId: string, now: Date): Promise<ZoneUsage["security"]> {
  return section(async () => {
    type Event = {
      action: string;
      source: string;
      clientCountryName: string;
      clientRequestPath: string;
    };
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const viewer = await graphql<{ zones: { firewallEventsAdaptive: Event[] }[] }>(
      env,
      `{ viewer { zones(filter: { zoneTag: "${zoneId}" }) { firewallEventsAdaptive(limit: ${SECURITY_EVENTS}, filter: { datetime_geq: "${since.toISOString()}", datetime_leq: "${now.toISOString()}" }, orderBy: [datetime_DESC]) { action source clientCountryName clientRequestPath } } } }`,
    );
    const events = viewer.zones[0]?.firewallEventsAdaptive ?? [];
    const tally = (pick: (e: Event) => string) => {
      const counts = new Map<string, number>();
      for (const e of events) counts.set(pick(e), (counts.get(pick(e)) ?? 0) + 1);
      return counts;
    };
    return {
      total: events.length,
      capped: events.length >= SECURITY_EVENTS,
      byAction: top(
        tally((e) => e.action),
        10,
      ),
      bySource: top(
        tally((e) => e.source),
        10,
      ),
      paths: top(
        tally((e) => e.clientRequestPath),
        10,
      ),
      countries: top(
        tally((e) => e.clientCountryName),
        5,
      ),
    };
  });
}

async function zones(env: Env, p: Period, now: Date): Promise<ZoneUsage[]> {
  const list = await rest<{ id: string; name: string; plan?: { name?: string } }[]>(
    env,
    `/zones?account.id=${env.CLOUDFLARE_ACCOUNT_ID}&per_page=50`,
  );
  return byName(
    await Promise.all(
      list.map(async (zone) => ({
        name: zone.name,
        plan: zone.plan?.name ?? "",
        traffic: await zoneTraffic(env, zone.id, p),
        security: await zoneSecurity(env, zone.id, now),
      })),
    ),
  );
}

const seconds = (iso: string | null | undefined) =>
  iso ? Math.floor(Date.parse(iso) / 1000) : null;

async function deploys(env: Env): Promise<WorkerDeploys[]> {
  const account = `/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
  type Script = { id: string; modified_on?: string };
  type Deployment = {
    created_on: string;
    source?: string;
    annotations?: Record<string, string>;
    versions?: { version_id: string; percentage: number }[];
  };
  const scripts = await rest<Script[]>(env, `${account}/workers/scripts`);
  return byName(
    await Promise.all(
      scripts.slice(0, 60).map(async (script) => {
        // The deployer's email is left out: the console doesn't need who pressed deploy.
        const result = await rest<{ deployments: Deployment[] }>(
          env,
          `${account}/workers/scripts/${encodeURIComponent(script.id)}/deployments`,
        ).catch(() => ({ deployments: [] }));
        return {
          name: script.id,
          modifiedAt: seconds(script.modified_on),
          deploys: result.deployments
            .sort((a, b) => (a.created_on < b.created_on ? 1 : -1))
            .slice(0, 3)
            .map((d) => ({
              createdAt: seconds(d.created_on) ?? 0,
              source: d.source ?? "",
              message: d.annotations?.["workers/message"] ?? null,
              versions: (d.versions ?? []).map(
                (v) =>
                  `${v.version_id.slice(0, 8)}${v.percentage < 100 ? ` (${v.percentage}%)` : ""}`,
              ),
            })),
        };
      }),
    ),
  );
}

/** The cost of `used` beyond what `price` includes. */
const over = (used: number, price: Price) =>
  (Math.max(0, used - price.included) / price.per) * price.price;

function meter(
  key: string,
  product: string,
  label: string,
  unit: Meter["unit"],
  used: number,
  price: Price,
): Meter {
  return {
    key,
    product,
    label,
    unit,
    used,
    included: price.included,
    period: "month",
    cost: over(used, price),
  };
}

const total = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((n, r) => n + pick(r), 0);

/** The account's meters from the parts Cloudflare answered, and the parts it didn't. */
function metersOf(parts: {
  workers: Section<WorkerUsage[]>;
  d1: Section<DatabaseUsage[]>;
  r2: Section<BucketUsage[]>;
  kv: Section<NamespaceUsage[]>;
  durableObjects: Section<DurableObjectsUsage>;
  queues: Section<{ operations: number }>;
  ai: Section<{ today: number; month: number; days: { date: string; neurons: number }[] }>;
}) {
  const meters: Meter[] = [];
  const missing: string[] = [];
  const { workers, d1, r2, kv, durableObjects, queues, ai } = parts;
  if (workers.ok) {
    meters.push(
      meter(
        "workersRequests",
        "Workers",
        "Requests",
        "count",
        total(workers.data, (w) => w.requests),
        PLAN.workersRequests,
      ),
    );
    if (workers.data.some((w) => w.cpuMs !== null)) {
      meters.push(
        meter(
          "workersCpu",
          "Workers",
          "CPU time",
          "ms",
          total(workers.data, (w) => w.cpuMs ?? 0),
          PLAN.workersCpuMs,
        ),
      );
    } else missing.push("Workers CPU time");
  } else missing.push("Workers");
  if (d1.ok) {
    meters.push(
      meter(
        "d1RowsRead",
        "D1",
        "Rows read",
        "count",
        total(d1.data, (d) => d.rowsRead),
        PLAN.d1RowsRead,
      ),
    );
    meters.push(
      meter(
        "d1RowsWritten",
        "D1",
        "Rows written",
        "count",
        total(d1.data, (d) => d.rowsWritten),
        PLAN.d1RowsWritten,
      ),
    );
    meters.push(
      meter(
        "d1Storage",
        "D1",
        "Storage",
        "bytes",
        total(d1.data, (d) => d.bytes),
        PLAN.d1Storage,
      ),
    );
  } else missing.push("D1");
  if (kv.ok) {
    meters.push(
      meter(
        "kvReads",
        "KV",
        "Reads",
        "count",
        total(kv.data, (n) => n.reads),
        PLAN.kvReads,
      ),
    );
    meters.push(
      meter(
        "kvWrites",
        "KV",
        "Writes",
        "count",
        total(kv.data, (n) => n.writes),
        PLAN.kvWrites,
      ),
    );
    meters.push(
      meter(
        "kvDeletes",
        "KV",
        "Deletes",
        "count",
        total(kv.data, (n) => n.deletes),
        PLAN.kvDeletes,
      ),
    );
    meters.push(
      meter(
        "kvLists",
        "KV",
        "Lists",
        "count",
        total(kv.data, (n) => n.lists),
        PLAN.kvLists,
      ),
    );
    meters.push(
      meter(
        "kvStorage",
        "KV",
        "Storage",
        "bytes",
        total(kv.data, (n) => n.bytes),
        PLAN.kvStorage,
      ),
    );
  } else missing.push("KV");
  if (r2.ok) {
    meters.push(
      meter(
        "r2Storage",
        "R2",
        "Storage",
        "bytes",
        total(r2.data, (b) => b.bytes),
        PLAN.r2Storage,
      ),
    );
    meters.push(
      meter(
        "r2ClassA",
        "R2",
        "Class A operations",
        "count",
        total(r2.data, (b) => b.classA),
        PLAN.r2ClassA,
      ),
    );
    meters.push(
      meter(
        "r2ClassB",
        "R2",
        "Class B operations",
        "count",
        total(r2.data, (b) => b.classB),
        PLAN.r2ClassB,
      ),
    );
  } else missing.push("R2");
  if (durableObjects.ok) {
    const d = durableObjects.data;
    meters.push(
      meter("doRequests", "Durable Objects", "Requests", "count", d.requests, PLAN.doRequests),
    );
    if (d.gbSeconds !== null) {
      meters.push(
        meter(
          "doDuration",
          "Durable Objects",
          "Duration",
          "gbSeconds",
          d.gbSeconds,
          PLAN.doDuration,
        ),
      );
    } else missing.push("Durable Objects duration");
    meters.push(
      meter("doStorage", "Durable Objects", "Storage", "bytes", d.storedBytes, PLAN.doStorage),
    );
  } else missing.push("Durable Objects");
  if (queues.ok) {
    meters.push(
      meter(
        "queueOperations",
        "Queues",
        "Operations",
        "count",
        queues.data.operations,
        PLAN.queueOperations,
      ),
    );
  } else missing.push("Queues");
  if (ai.ok) {
    const price = PLAN.aiNeuronsDaily;
    meters.push({
      key: "aiNeurons",
      product: "Workers AI",
      label: "Neurons today",
      unit: "count",
      used: ai.data.today,
      included: price.included,
      period: "day",
      cost: total(ai.data.days, (d) => over(d.neurons, price)),
    });
  } else missing.push("Workers AI");
  return { meters, missing };
}

/** Every meter at WARN_AT of what's included, and every database near D1's size limit. */
function warningsOf(meters: Meter[], d1: Section<DatabaseUsage[]>): Warning[] {
  const warnings: Warning[] = meters
    .filter((m) => m.used >= m.included * WARN_AT)
    .map((m) => ({
      label: `${m.product}: ${m.label}`,
      used: m.used,
      limit: m.included,
      unit: m.unit,
    }));
  if (d1.ok) {
    for (const db of d1.data) {
      if (db.bytes >= PLAN.d1DatabaseMaxBytes * WARN_AT) {
        warnings.push({
          label: `D1: ${db.name} size`,
          used: db.bytes,
          limit: PLAN.d1DatabaseMaxBytes,
          unit: "bytes",
        });
      }
    }
  }
  return warnings;
}

async function load(env: Env): Promise<CloudflareOverview> {
  const now = new Date();
  const p = thisMonth(now);
  const [w, d, r, k, o, q, a, z, dep] = await Promise.all([
    section(() => workers(env, p)),
    section(() => d1(env, p)),
    section(() => r2(env, p)),
    section(() => kv(env, p)),
    section(() => durableObjects(env, p)),
    section(() => queues(env, p)),
    section(() => ai(env, p)),
    section(() => zones(env, p, now)),
    section(() => deploys(env)),
  ]);
  const parts = { workers: w, d1: d, r2: r, kv: k, durableObjects: o, queues: q, ai: a };
  const { meters, missing } = metersOf(parts);
  const overage = total(meters, (m) => m.cost);
  return {
    configured: true,
    asOf: Math.floor(now.getTime() / 1000),
    plan: PLAN.name,
    period: { start: Math.floor(p.start.getTime() / 1000), end: Math.floor(now.getTime() / 1000) },
    meters,
    estimate: { base: PLAN.base, overage, total: PLAN.base + overage, missing },
    warnings: warningsOf(meters, d),
    ...parts,
    zones: z,
    deploys: dep,
  };
}

// Only a finished load is kept: a request can't wait on another request's fetches in Workers.
let kept: { at: number; overview: CloudflareOverview } | null = null;

/** The page's data, from the last 5 minutes when there is one. */
export async function cloudflareOverview(env: Env): Promise<CloudflareOverview> {
  if (!env.CLOUDFLARE_API_TOKEN || !ACCOUNT_ID.test(env.CLOUDFLARE_ACCOUNT_ID ?? "")) {
    return { configured: false };
  }
  if (kept && Date.now() - kept.at < KEPT_MS) return kept.overview;
  const overview = await load(env);
  kept = { at: Date.now(), overview };
  return overview;
}

/** Tests only: forgets what's kept. */
export function forgetCloudflareOverview() {
  kept = null;
}
