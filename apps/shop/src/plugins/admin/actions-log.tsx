import { useEffect, useMemo, useState } from "react";
import { fetchActions } from "../../shared/getters";
import type { Action } from "../../shared/types";
import { ErrorBanner } from "../../shared/ui";
import type { ShopData } from "../../shared/use-shop-data";
import { useUserNames } from "../../shared/use-user-names";

const ACTION_LABELS: Record<Action["action"], string> = {
  started: "Marked In Progress",
  completed: "Marked Complete",
};

type SortKey = "time" | "user" | "part" | "process" | "action";

/** Searchable, filterable, sortable table of the part-status audit log. */
export function ActionsLog({ data }: { data: ShopData }) {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [partFilter, setPartFilter] = useState("all");
  const [processFilter, setProcessFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    fetchActions()
      .then(setActions)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load actions."));
  }, []);

  const resolveName = useUserNames((actions ?? []).map((a) => a.userId));

  const instById = useMemo(() => new Map(data.instances.map((i) => [i.id, i])), [data.instances]);
  const defById = useMemo(
    () => new Map(data.definitions.map((d) => [d.id, d])),
    [data.definitions],
  );
  const processById = useMemo(
    () => new Map(data.processes.map((p) => [p.id, p])),
    [data.processes],
  );

  const rows = useMemo(() => {
    return (actions ?? []).map((a) => {
      const instance = instById.get(a.partInstanceId);
      const definition = instance ? defById.get(instance.partDefinitionId) : undefined;
      const partLabel = definition
        ? `${definition.name} #${instance?.instanceNumber ?? "?"}`
        : `Instance ${a.partInstanceId}`;
      return {
        action: a,
        userName: resolveName(a.userId),
        partLabel,
        partNumber: definition?.onshapePartNumber ?? "",
        definitionId: definition?.id ?? null,
        processName: processById.get(a.processId)?.name ?? `Process #${a.processId}`,
      };
    });
  }, [actions, instById, defById, processById, resolveName]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;

    const result = rows.filter((r) => {
      if (userFilter !== "all" && r.action.userId !== userFilter) return false;
      if (partFilter !== "all" && String(r.definitionId) !== partFilter) return false;
      if (processFilter !== "all" && String(r.action.processId) !== processFilter) return false;
      if (from !== null && r.action.createdAt < from) return false;
      if (to !== null && r.action.createdAt > to) return false;
      if (q) {
        const haystack =
          `${r.userName} ${r.partLabel} ${r.partNumber} ${r.processName} ${ACTION_LABELS[r.action.action]}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    result.sort((a, b) => {
      switch (sortKey) {
        case "user":
          return a.userName.localeCompare(b.userName) * dir;
        case "part":
          return a.partLabel.localeCompare(b.partLabel) * dir;
        case "process":
          return a.processName.localeCompare(b.processName) * dir;
        case "action":
          return a.action.action.localeCompare(b.action.action) * dir;
        default:
          return (a.action.createdAt - b.action.createdAt) * dir;
      }
    });
    return result;
  }, [rows, search, userFilter, partFilter, processFilter, fromDate, toDate, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "time" ? "desc" : "asc");
    }
  }

  const userOptions = useMemo(() => {
    const ids = [...new Set((actions ?? []).map((a) => a.userId))];
    return ids
      .map((id) => ({ id, name: resolveName(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [actions, resolveName]);

  if (error) return <ErrorBanner message={error} />;
  if (!actions) return <p className="text-sm text-steel">Loading actions…</p>;
  if (actions.length === 0)
    return (
      <p className="text-sm text-steel">
        No actions yet. They appear as parts move through the shop.
      </p>
    );

  const selectClass =
    "bg-paper border border-steel/40 rounded-lg px-2.5 py-2 text-sm text-ink focus:outline-none focus:border-crimson";

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search actions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-40 bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
        />
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className={selectClass}
        >
          <option value="all">All users</option>
          {userOptions.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select
          value={partFilter}
          onChange={(e) => setPartFilter(e.target.value)}
          className={selectClass}
        >
          <option value="all">All parts</option>
          {data.definitions.map((d) => (
            <option key={d.id} value={String(d.id)}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          value={processFilter}
          onChange={(e) => setProcessFilter(e.target.value)}
          className={selectClass}
        >
          <option value="all">All machines</option>
          {data.processes.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-steel">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className={selectClass}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-steel">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className={selectClass}
          />
        </label>
      </div>

      {/* Table */}
      <div className="border border-steel/25 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-mist text-left text-xs font-semibold uppercase tracking-wider text-steel">
              <SortHeader
                label="Time"
                k="time"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label="User"
                k="user"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label="Part"
                k="part"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label="Machine"
                k="process"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label="Action"
                k="action"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-steel/15">
            {filtered.map((r) => (
              <tr key={r.action.id}>
                <td className="px-3 py-2 whitespace-nowrap text-steel-dark">
                  {new Date(r.action.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-3 py-2 text-ink">{r.userName}</td>
                <td className="px-3 py-2">
                  <span className="text-ink">{r.partLabel}</span>
                  {r.partNumber && (
                    <span className="ml-1.5 font-mono text-xs text-steel">{r.partNumber}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-steel-dark">{r.processName}</td>
                <td className="px-3 py-2">
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                      r.action.action === "completed"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                        : "bg-amber-50 text-amber-700 border-amber-300"
                    }`}
                  >
                    {ACTION_LABELS[r.action.action]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-sm text-steel px-3 py-4">No actions match these filters.</p>
        )}
      </div>
      <p className="text-xs text-steel">
        {filtered.length} of {actions.length} action{actions.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function SortHeader({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th className="px-3 py-2">
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`flex items-center gap-1 uppercase tracking-wider ${
          active ? "text-crimson" : "hover:text-ink"
        }`}
      >
        {label}
        {active && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
