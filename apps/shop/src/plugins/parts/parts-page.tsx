import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  type InstanceRow,
  type InstanceState,
  STATE_META,
  buildInstanceRows,
} from "../../shared/derive";
import { processPath } from "../../shared/nav";
import { ErrorBanner, PageLoading } from "../../shared/ui";
import { useAuthUser } from "../../shared/use-auth";
import type { ShopData } from "../../shared/use-shop-data";
import { useShopData } from "../../shared/use-shop-data";
import { useTouchDevice } from "../../shared/use-touch";
import { PartCard } from "./part-card";

type SortKey =
  | "newest"
  | "oldest"
  | "alpha"
  | "alpha-rev"
  | "number"
  | "number-rev"
  | "revision"
  | "revision-rev"
  | "instance"
  | "instance-rev"
  | "process"
  | "process-rev"
  | "progress"
  | "progress-rev"
  | "priority"
  | "status"
  | "subsystem";

/** Sorts that order whole blueprints — instances stay grouped with a connector line. */
const GROUPED_SORTS: SortKey[] = ["newest", "oldest", "alpha", "priority", "subsystem"];

type Filters = {
  priority: "all" | "priority" | "standard";
  subsystemId: number;
  processId: number;
  state: "" | InstanceState;
  revision: string;
  minQty: number;
};

const DEFAULT_FILTERS: Filters = {
  priority: "all",
  subsystemId: 0,
  processId: 0,
  state: "",
  revision: "",
  minQty: 0,
};

export function PartsPage() {
  const { data, loading, error, refresh } = useShopData();
  const touch = useTouchDevice();
  const navigate = useNavigate();
  const user = useAuthUser();
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [lookupPartNumber, setLookupPartNumber] = useState("");

  // A link to a part's details view (`?instance=`, from its shop view) opens its card. The
  // address is then put back as it was, so closing the card doesn't leave it to open again.
  useEffect(() => {
    const instance = searchParams.get("instance");
    if (!instance) return;
    setSelectedInstanceId(Number(instance));
    const rest = new URLSearchParams(searchParams);
    rest.delete("instance");
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams]);
  const [showRestrictedModal, setShowRestrictedModal] = useState(false);

  const handleAddPartClick = () => {
    if (user?.isAdmin) {
      navigate("/parts/new");
    } else {
      setShowRestrictedModal(true);
    }
  };

  // Live (non-obsolete) rows split into "in production" vs. fully complete;
  // obsolete rows get their own table.
  const liveRows = useMemo(() => (data ? buildInstanceRows(data) : []), [data]);
  const obsoleteRows = useMemo(
    () =>
      data ? buildInstanceRows(data, { includeStale: true }).filter((r) => r.instance.isStale) : [],
    [data],
  );
  const activeRows = useMemo(() => liveRows.filter((r) => r.state !== "complete"), [liveRows]);
  const completeRows = useMemo(() => liveRows.filter((r) => r.state === "complete"), [liveRows]);

  // Total instances ever made per definition — drives the "#n of N total" label.
  const totalByDef = useMemo(() => {
    const map = new Map<number, number>();
    for (const inst of data?.instances ?? []) {
      if (inst.isStale === 0) {
        map.set(inst.partDefinitionId, (map.get(inst.partDefinitionId) ?? 0) + 1);
      }
    }
    return map;
  }, [data]);

  if (loading) return <PageLoading />;

  const selectedRow =
    selectedInstanceId !== null
      ? ([...liveRows, ...obsoleteRows].find((r) => r.instance.id === selectedInstanceId) ?? null)
      : null;

  return (
    <main className="min-h-screen bg-page">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-4xl text-ink">Parts</h1>
          <button
            type="button"
            onClick={handleAddPartClick}
            className={`bg-crimson hover:bg-crimson-dark text-paper text-sm font-semibold rounded-lg transition-colors ${
              touch ? "px-5 py-3" : "px-4 py-2"
            }`}
          >
            + Add Part
          </button>
        </div>

        {error && <ErrorBanner message={error} />}

        {/* Full Part Details Lookup */}
        <div className="bg-paper border border-steel/30 rounded-xl p-5">
          <h2 className="font-semibold text-ink mb-3">Full Part Details</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={lookupPartNumber}
              onChange={(e) => setLookupPartNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && lookupPartNumber.trim()) {
                  navigate(`/part?p=${encodeURIComponent(lookupPartNumber.trim())}`);
                }
              }}
              placeholder="Enter part number (e.g., P-0042)"
              className="flex-1 bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
            />
            <button
              type="button"
              onClick={() => {
                if (lookupPartNumber.trim()) {
                  navigate(`/part?p=${encodeURIComponent(lookupPartNumber.trim())}`);
                }
              }}
              className="px-4 py-2 bg-crimson hover:bg-crimson-dark text-paper text-sm font-semibold rounded-lg transition-colors"
            >
              View
            </button>
          </div>
        </div>

        {data && (
          <>
            <PartsTable
              title="In Production"
              rows={activeRows}
              data={data}
              totalByDef={totalByDef}
              touch={touch}
              onOpen={setSelectedInstanceId}
              emptyAll="No parts in production yet. Add one to get started."
            />
            <PartsTable
              title="Complete"
              rows={completeRows}
              data={data}
              totalByDef={totalByDef}
              touch={touch}
              onOpen={setSelectedInstanceId}
              emptyAll="No completed parts yet."
            />
            <PartsTable
              title="Obsolete"
              rows={obsoleteRows}
              data={data}
              totalByDef={totalByDef}
              touch={touch}
              onOpen={setSelectedInstanceId}
              emptyAll="No obsolete parts."
            />
          </>
        )}
      </div>

      {selectedRow && data && (
        <PartCard
          row={selectedRow}
          data={data}
          onClose={() => setSelectedInstanceId(null)}
          onChanged={refresh}
        />
      )}

      {/* Restricted Add Part Modal */}
      {showRestrictedModal && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-paper rounded-lg shadow-lg max-w-sm w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-ink">Manual Part Entry Restricted</h3>
            <p className="text-sm text-steel space-y-3">
              <div>You can no longer manually create parts.</div>
              <div className="space-y-2">
                <div>To add a new part, follow these steps:</div>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Release the part in OnShape</li>
                  <li>Get it approved</li>
                  <li>Assign manufacturing processes</li>
                  <li>It will then appear in the shop software</li>
                </ol>
              </div>
              <div>If you absolutely need a part manually created, see an admin.</div>
            </p>
            <button
              type="button"
              onClick={() => setShowRestrictedModal(false)}
              className="w-full py-2 rounded-lg bg-crimson text-paper text-sm font-semibold hover:bg-crimson-dark transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

// ── Per-table: own search, filters and sort ────────────────────────────────────

function PartsTable({
  title,
  rows,
  data,
  totalByDef,
  touch,
  onOpen,
  emptyAll,
}: {
  title: string;
  rows: InstanceRow[];
  data: ShopData;
  totalByDef: Map<number, number>;
  touch: boolean;
  onOpen: (instanceId: number) => void;
  emptyAll: string;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const processName = (pid: number) =>
    data.processes.find((p) => p.id === pid)?.name ?? `Process #${pid}`;
  const subsystemName = (sid: number) => data.subsystems.find((s) => s.id === sid)?.name ?? "—";

  const qtyByDef = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of rows) map.set(r.definition.id, (map.get(r.definition.id) ?? 0) + 1);
    return map;
  }, [rows]);

  // ── Filter ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hay =
          `${r.definition.name} ${r.definition.onshapePartNumber} ${r.definition.revision}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.priority === "priority" && !r.instance.isPriority) return false;
      if (filters.priority === "standard" && r.instance.isPriority) return false;
      if (filters.subsystemId && r.definition.subsystemId !== filters.subsystemId) return false;
      if (filters.processId && r.current?.processId !== filters.processId) return false;
      if (filters.state && r.state !== filters.state) return false;
      if (
        filters.revision.trim() &&
        r.definition.revision.toLowerCase() !== filters.revision.trim().toLowerCase()
      )
        return false;
      if (filters.minQty > 0 && (qtyByDef.get(r.definition.id) ?? 0) < filters.minQty) return false;
      return true;
    });
  }, [rows, search, filters, qtyByDef]);

  // ── Sort + group ────────────────────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: processName/subsystemName derive from data, which filtered already depends on
  const groups = useMemo(() => {
    const flat = [...filtered];

    if (sort === "alpha") {
      flat.sort((a, b) => a.definition.name.localeCompare(b.definition.name));
    } else if (sort === "alpha-rev") {
      flat.sort((a, b) => b.definition.name.localeCompare(a.definition.name));
    } else if (sort === "number") {
      flat.sort((a, b) =>
        a.definition.onshapePartNumber.localeCompare(b.definition.onshapePartNumber),
      );
    } else if (sort === "number-rev") {
      flat.sort((a, b) =>
        b.definition.onshapePartNumber.localeCompare(a.definition.onshapePartNumber),
      );
    } else if (sort === "revision") {
      flat.sort((a, b) => a.definition.revision.localeCompare(b.definition.revision));
    } else if (sort === "revision-rev") {
      flat.sort((a, b) => b.definition.revision.localeCompare(a.definition.revision));
    } else if (sort === "instance") {
      flat.sort((a, b) => a.instance.instanceNumber - b.instance.instanceNumber);
    } else if (sort === "instance-rev") {
      flat.sort((a, b) => b.instance.instanceNumber - a.instance.instanceNumber);
    } else if (sort === "process") {
      flat.sort((a, b) => {
        const an = a.current ? processName(a.current.processId) : "￿";
        const bn = b.current ? processName(b.current.processId) : "￿";
        return an.localeCompare(bn);
      });
    } else if (sort === "process-rev") {
      flat.sort((a, b) => {
        const an = b.current ? processName(b.current.processId) : "￿";
        const bn = a.current ? processName(a.current.processId) : "￿";
        return an.localeCompare(bn);
      });
    } else if (sort === "progress") {
      flat.sort((a, b) => {
        const aProcs = a.procs ?? [];
        const bProcs = b.procs ?? [];
        const aPercent =
          aProcs.length > 0
            ? ((aProcs.filter((p) => p.status === "done").length +
                aProcs.filter((p) => p.status === "doing").length * 0.5) /
                aProcs.length) *
              100
            : -1;
        const bPercent =
          bProcs.length > 0
            ? ((bProcs.filter((p) => p.status === "done").length +
                bProcs.filter((p) => p.status === "doing").length * 0.5) /
                bProcs.length) *
              100
            : -1;
        return bPercent - aPercent;
      });
    } else if (sort === "progress-rev") {
      flat.sort((a, b) => {
        const aProcs = a.procs ?? [];
        const bProcs = b.procs ?? [];
        const aPercent =
          aProcs.length > 0
            ? ((aProcs.filter((p) => p.status === "done").length +
                aProcs.filter((p) => p.status === "doing").length * 0.5) /
                aProcs.length) *
              100
            : -1;
        const bPercent =
          bProcs.length > 0
            ? ((bProcs.filter((p) => p.status === "done").length +
                bProcs.filter((p) => p.status === "doing").length * 0.5) /
                bProcs.length) *
              100
            : -1;
        return aPercent - bPercent;
      });
    } else if (sort === "priority" || sort === "subsystem" || !GROUPED_SORTS.includes(sort)) {
      // For non-column sorts, still use grouped sorting
      const byDef = new Map<number, InstanceRow[]>();
      for (const r of flat) {
        const list = byDef.get(r.definition.id);
        if (list) list.push(r);
        else byDef.set(r.definition.id, [r]);
      }
      const grouped = [...byDef.values()];
      for (const g of grouped)
        g.sort((a, b) => a.instance.instanceNumber - b.instance.instanceNumber);

      const def = (g: InstanceRow[]) => g[0].definition;
      if (sort === "priority") {
        for (const g of grouped)
          g.sort(
            (a, b) =>
              b.instance.isPriority - a.instance.isPriority ||
              a.instance.instanceNumber - b.instance.instanceNumber,
          );
        grouped.sort(
          (a, b) =>
            Math.max(...b.map((r) => r.instance.isPriority)) -
              Math.max(...a.map((r) => r.instance.isPriority)) ||
            def(b).createdAt - def(a).createdAt,
        );
      } else if (sort === "subsystem") {
        grouped.sort(
          (a, b) =>
            subsystemName(def(a).subsystemId).localeCompare(subsystemName(def(b).subsystemId)) ||
            def(a).name.localeCompare(def(b).name),
        );
      } else if (sort === "oldest") {
        grouped.sort((a, b) => def(a).createdAt - def(b).createdAt);
      } else {
        // newest, status, default
        grouped.sort((a, b) => def(b).createdAt - def(a).createdAt);
      }
      return grouped;
    }

    return flat.map((r) => [r]);
  }, [filtered, sort]);

  const activeFilterCount =
    (filters.priority !== "all" ? 1 : 0) +
    (filters.subsystemId ? 1 : 0) +
    (filters.processId ? 1 : 0) +
    (filters.state ? 1 : 0) +
    (filters.revision.trim() ? 1 : 0) +
    (filters.minQty > 0 ? 1 : 0);

  const controlPad = touch ? "py-3" : "py-2";

  return (
    <section className="space-y-3">
      <h2 className="font-display text-2xl text-ink">
        {title} <span className="text-steel text-lg font-normal">({rows.length})</span>
      </h2>

      {/* Toolbar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, part number, or revision…"
            className={`flex-1 min-w-52 bg-paper border border-steel/40 rounded-lg px-3 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson ${controlPad}`}
          />
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            className={`px-3 text-sm font-medium rounded-lg border transition-colors ${controlPad} ${
              filtersOpen || activeFilterCount > 0
                ? "bg-crimson-tint border-crimson/40 text-crimson-dark"
                : "bg-paper border-steel/40 text-steel-dark hover:border-steel"
            }`}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
          <label className="flex items-center gap-2 text-sm text-steel-dark">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className={`bg-paper border border-steel/40 rounded-lg px-2.5 text-sm text-ink focus:outline-none focus:border-crimson ${controlPad}`}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="alpha">A–Z</option>
              <option value="priority">Priority first</option>
              <option value="process">By process</option>
              <option value="status">By status</option>
              <option value="subsystem">By subsystem</option>
            </select>
          </label>
        </div>

        {filtersOpen && (
          <div className="bg-paper border border-steel/30 rounded-xl p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <FilterSelect
              label="Priority"
              value={filters.priority}
              onChange={(v) => setFilters({ ...filters, priority: v as Filters["priority"] })}
              options={[
                ["all", "All"],
                ["priority", "Priority only"],
                ["standard", "Standard only"],
              ]}
            />
            <FilterSelect
              label="Subsystem"
              value={String(filters.subsystemId)}
              onChange={(v) => setFilters({ ...filters, subsystemId: Number(v) })}
              options={[
                ["0", "All"],
                ...data.subsystems.map((s): [string, string] => [String(s.id), s.name]),
              ]}
            />
            <FilterSelect
              label="Process"
              value={String(filters.processId)}
              onChange={(v) => setFilters({ ...filters, processId: Number(v) })}
              options={[
                ["0", "All"],
                ...data.processes.map((p): [string, string] => [String(p.id), p.name]),
              ]}
            />
            <FilterSelect
              label="Status"
              value={filters.state}
              onChange={(v) => setFilters({ ...filters, state: v as Filters["state"] })}
              options={[
                ["", "All"],
                ...Object.entries(STATE_META).map(([k, m]): [string, string] => [k, m.label]),
              ]}
            />
            <div className="space-y-1">
              <span className="text-xs font-medium text-steel-dark">Revision</span>
              <input
                type="text"
                value={filters.revision}
                onChange={(e) => setFilters({ ...filters, revision: e.target.value })}
                placeholder="e.g. B"
                className="w-full bg-paper border border-steel/40 rounded-lg px-2.5 py-1.5 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-steel-dark">Min Quantity</span>
              <input
                type="number"
                min={0}
                value={filters.minQty || ""}
                onChange={(e) =>
                  setFilters({ ...filters, minQty: Math.max(0, Number(e.target.value)) })
                }
                placeholder="Any"
                className="w-full bg-paper border border-steel/40 rounded-lg px-2.5 py-1.5 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
              />
            </div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="self-end text-sm text-crimson hover:text-crimson-dark font-medium text-left pb-1.5"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-paper border border-steel/30 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-2 border-b border-steel/25 bg-mist text-xs font-semibold uppercase tracking-wider text-steel">
          <span className="w-3.5 shrink-0" />
          <button
            type="button"
            onClick={() => setSort(sort === "alpha" ? "alpha-rev" : "alpha")}
            className="flex-1 min-w-0 text-left hover:text-ink transition-colors cursor-pointer"
          >
            Part {sort === "alpha" ? "↓" : sort === "alpha-rev" ? "↑" : ""}
          </button>
          <button
            type="button"
            onClick={() => setSort(sort === "number" ? "number-rev" : "number")}
            className="w-44 shrink-0 hidden sm:block text-left hover:text-ink transition-colors cursor-pointer"
          >
            Number {sort === "number" ? "↓" : sort === "number-rev" ? "↑" : ""}
          </button>
          <button
            type="button"
            onClick={() => setSort(sort === "revision" ? "revision-rev" : "revision")}
            className="w-12 shrink-0 hidden sm:block text-center hover:text-ink transition-colors cursor-pointer"
          >
            Rev {sort === "revision" ? "↓" : sort === "revision-rev" ? "↑" : ""}
          </button>
          <button
            type="button"
            onClick={() => setSort(sort === "instance" ? "instance-rev" : "instance")}
            className="w-16 shrink-0 hidden sm:block text-center hover:text-ink transition-colors cursor-pointer"
          >
            Inst {sort === "instance" ? "↓" : sort === "instance-rev" ? "↑" : ""}
          </button>
          <button
            type="button"
            onClick={() => setSort(sort === "process" ? "process-rev" : "process")}
            className="w-40 shrink-0 hidden md:block text-center hover:text-ink transition-colors cursor-pointer"
          >
            Proc {sort === "process" ? "↓" : sort === "process-rev" ? "↑" : ""}
          </button>
          <button
            type="button"
            onClick={() => setSort(sort === "progress" ? "progress-rev" : "progress")}
            className="w-20 shrink-0 text-center hover:text-ink transition-colors cursor-pointer"
          >
            Progress {sort === "progress" ? "↓" : sort === "progress-rev" ? "↑" : ""}
          </button>
        </div>

        {groups.length === 0 && (
          <p className="text-steel text-sm text-center py-12">
            {rows.length === 0 ? emptyAll : "No parts match your search or filters."}
          </p>
        )}

        <div className="divide-y divide-steel/15">
          {groups.map((group) =>
            group.map((row, i) => {
              const activeForDef = (data?.instances ?? []).filter(
                (inst) => inst.partDefinitionId === row.definition.id && inst.isStale === 0,
              );
              const activePosition =
                activeForDef.findIndex((inst) => inst.id === row.instance.id) + 1;
              return (
                <PartRow
                  key={row.instance.id}
                  row={row}
                  total={totalByDef.get(row.definition.id) ?? 1}
                  activePosition={activePosition}
                  connector={
                    group.length === 1
                      ? "only"
                      : i === 0
                        ? "first"
                        : i === group.length - 1
                          ? "last"
                          : "middle"
                  }
                  processName={processName}
                  touch={touch}
                  onOpen={() => onOpen(row.instance.id)}
                />
              );
            }),
          )}
        </div>
      </div>
    </section>
  );
}

function PartRow({
  row,
  total,
  activePosition,
  connector,
  processName,
  touch,
  onOpen,
}: {
  row: InstanceRow;
  total: number;
  activePosition: number;
  connector: "only" | "first" | "middle" | "last";
  processName: (pid: number) => string;
  touch: boolean;
  onOpen: () => void;
}) {
  // Progress indicator: colors based on current process and completion
  const progressSteps = row.procs.map((proc) => {
    if (proc.status === "done") return "done";
    if (row.current?.id === proc.id && proc.status !== "todo") return "current";
    return "pending";
  });

  return (
    <div
      className={`relative flex items-center gap-3 px-3 cursor-pointer hover:bg-mist/70 transition-colors ${
        touch ? "py-4" : "py-2.5"
      }`}
      onClick={onOpen}
      title="View part details"
    >
      {row.instance.isPriority ? (
        <span className="absolute left-0 inset-y-0 w-1 bg-amber-400" title="Priority part" />
      ) : null}

      <Connector pos={connector} />

      <span
        className="flex-1 min-w-0 text-sm font-medium text-ink truncate"
        title={`Part name: ${row.definition.name}`}
      >
        {row.definition.name}
      </span>

      <span
        className="w-44 shrink-0 hidden sm:block text-sm font-mono text-steel-dark truncate"
        title={`Onshape part number: ${row.definition.onshapePartNumber}`}
      >
        {row.definition.onshapePartNumber}
      </span>

      <span
        className="w-12 shrink-0 hidden sm:block text-xs font-mono text-steel-dark text-center"
        title={`Revision: ${row.definition.revision}`}
      >
        {row.definition.revision}
      </span>

      <span
        className="w-16 shrink-0 hidden sm:block text-xs text-steel-dark text-center"
        title={`Instance ${activePosition} of ${total}`}
      >
        {activePosition}/{total}
      </span>

      <span className="w-40 shrink-0 hidden md:block text-sm text-ink text-center">
        {row.current ? (
          <Link
            to={processPath(row.current.processId)}
            onClick={(e) => e.stopPropagation()}
            className="text-ink hover:text-crimson underline decoration-steel/40 hover:decoration-crimson transition-colors"
            title={`Go to ${processName(row.current.processId)} on the shop floor`}
          >
            {processName(row.current.processId)}
          </Link>
        ) : (
          "—"
        )}
      </span>

      <span
        className="w-20 shrink-0 flex gap-1.5 items-center justify-center"
        title={row.procs.length > 0 ? "Manufacturing progress" : ""}
      >
        {progressSteps.map((step, i) => (
          <span
            key={`${row.procs[i]?.id}-${step}`}
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              step === "done"
                ? "bg-emerald-500"
                : step === "current"
                  ? "bg-amber-400"
                  : "bg-steel/20"
            }`}
          />
        ))}
      </span>
    </div>
  );
}

/** Vertical line tying instances of the same blueprint together. */
function Connector({ pos }: { pos: "only" | "first" | "middle" | "last" }) {
  if (pos === "only") return <span className="w-3.5 shrink-0" />;
  return (
    <span className="relative w-3.5 self-stretch shrink-0" aria-hidden="true">
      <span
        className={`absolute left-1/2 -translate-x-1/2 w-px bg-steel/50 ${
          pos === "first" ? "top-1/2 bottom-0" : pos === "last" ? "top-0 bottom-1/2" : "inset-y-0"
        }`}
      />
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-steel/60" />
    </span>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-steel-dark">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-paper border border-steel/40 rounded-lg px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-crimson"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
