import { useEffect, useMemo, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { fetchQualityReports } from "../../shared/getters";
import { QUALITY_CHECKS, type QualityReport } from "../../shared/types";
import { ErrorBanner, InfoTip } from "../../shared/ui";
import { useUserNames } from "../../shared/use-user-names";

type SortKey = "time" | "reporter" | "part" | "result" | "outcome";

const STATUS_LABELS = { todo: "To Do", doing: "In Progress" } as const;

function when(at: number) {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The checks a report says the part failed, by label. */
function failedChecks(r: QualityReport) {
  return QUALITY_CHECKS.filter((c) => !r[c.field]).map((c) => c.label);
}

/** What happened to the part after the report. */
function outcomeLabel(r: QualityReport) {
  if (r.outcome === "passed") return "Passed";
  if (r.outcome === "not_sent_back") return "Not sent back";
  const status = r.sentBackStatus ? ` (${STATUS_LABELS[r.sentBackStatus]})` : "";
  return `Sent back to ${r.sentBackProcessName}${status}`;
}

/**
 * The Quality Reports section: whether Quality Control steps are finished with a report, and every
 * report the team has made, searchable, filterable and sortable.
 */
export function QualityReports() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [reports, setReports] = useState<QualityReport[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [reporterFilter, setReporterFilter] = useState("all");
  const [partFilter, setPartFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState<"all" | "passed" | "problem">("all");
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | QualityReport["outcome"]>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    api.admin.quality
      .$get()
      .then(async (res) => {
        if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
        setEnabled(((await res.json()) as { qualityReports: boolean }).qualityReports);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load the setting."));
    fetchQualityReports()
      .then(setReports)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load reports."));
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    setEnabled(next);
    const res = await api.admin.quality.settings.$put({ json: { qualityReports: next } });
    if (!res.ok) {
      setEnabled(!next);
      setError(await getErrorMessage(res as unknown as Response));
    } else {
      setError(null);
    }
    setBusy(false);
  }

  const resolveName = useUserNames(
    (reports ?? []).flatMap((r) => [
      r.reportedBy,
      r.outcomeBy,
      ...r.suspects.map((s) => s.completedBy),
    ]),
  );

  const rows = useMemo(
    () =>
      (reports ?? []).map((r) => ({
        report: r,
        reporter: resolveName(r.reportedBy),
        part: `${r.partName} #${r.instanceNumber}`,
        failed: failedChecks(r),
        outcome: outcomeLabel(r),
      })),
    [reports, resolveName],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    const result = rows.filter(({ report: r, ...row }) => {
      if (reporterFilter !== "all" && r.reportedBy !== reporterFilter) return false;
      if (partFilter !== "all" && String(r.partDefinitionId) !== partFilter) return false;
      if (resultFilter === "passed" && !r.passed) return false;
      if (resultFilter === "problem" && r.passed) return false;
      if (outcomeFilter !== "all" && r.outcome !== outcomeFilter) return false;
      if (from !== null && r.createdAt < from) return false;
      if (to !== null && r.createdAt > to) return false;
      if (q) {
        const haystack = [
          row.reporter,
          row.part,
          r.partNumber,
          r.processName,
          r.notes ?? "",
          row.outcome,
          ...row.failed,
          ...r.suspects.flatMap((s) => [s.name, resolveName(s.completedBy)]),
          r.unsure ? "unsure" : "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    result.sort((a, b) => {
      switch (sortKey) {
        case "reporter":
          return a.reporter.localeCompare(b.reporter) * dir;
        case "part":
          return a.part.localeCompare(b.part) * dir;
        case "result":
          return (a.report.passed - b.report.passed) * dir;
        case "outcome":
          return a.outcome.localeCompare(b.outcome) * dir;
        default:
          return (a.report.createdAt - b.report.createdAt) * dir;
      }
    });
    return result;
  }, [
    rows,
    search,
    reporterFilter,
    partFilter,
    resultFilter,
    outcomeFilter,
    fromDate,
    toDate,
    sortKey,
    sortDir,
    resolveName,
  ]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "time" ? "desc" : "asc");
    }
  }

  const reporterOptions = useMemo(
    () =>
      [...new Set((reports ?? []).map((r) => r.reportedBy))]
        .map((id) => ({ id, name: resolveName(id) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [reports, resolveName],
  );
  const partOptions = useMemo(() => {
    const byId = new Map<number, string>();
    for (const r of reports ?? []) byId.set(r.partDefinitionId, r.partName);
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [reports]);

  const selectClass =
    "bg-paper border border-steel/40 rounded-lg px-2.5 py-2 text-sm text-ink focus:outline-none focus:border-crimson";

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}

      {enabled !== null && (
        <div className="flex items-center gap-2 text-sm text-ink">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(e) => toggle(e.target.checked)}
              className="accent-crimson w-4 h-4"
            />
            Quality reports
          </label>
          <InfoTip label="What quality reports do">
            At a Quality Control process, Start Part and Mark as Complete become one Start Quality
            Report button. A shop manager checks the part against its drawing; if something's wrong,
            they pick the step it likely came from and send the part back. Every report is kept in
            the table below.
          </InfoTip>
        </div>
      )}

      {!reports ? (
        !error && <p className="text-sm text-steel">Loading reports…</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-steel">No quality reports yet.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search reports…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-40 bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
            />
            <select
              aria-label="Reported by"
              value={reporterFilter}
              onChange={(e) => setReporterFilter(e.target.value)}
              className={selectClass}
            >
              <option value="all">Everyone</option>
              {reporterOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Part"
              value={partFilter}
              onChange={(e) => setPartFilter(e.target.value)}
              className={selectClass}
            >
              <option value="all">All parts</option>
              {partOptions.map(([id, name]) => (
                <option key={id} value={String(id)}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Result"
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value as typeof resultFilter)}
              className={selectClass}
            >
              <option value="all">Any result</option>
              <option value="passed">Passed</option>
              <option value="problem">Problem</option>
            </select>
            <select
              aria-label="What happened"
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value as typeof outcomeFilter)}
              className={selectClass}
            >
              <option value="all">Anything happened</option>
              <option value="passed">Passed</option>
              <option value="sent_back">Sent back</option>
              <option value="not_sent_back">Not sent back</option>
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

          <div className="border border-steel/25 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-mist text-left text-xs font-semibold uppercase tracking-wider text-steel">
                  <SortHeader label="When" k="time" {...{ sortKey, sortDir, onSort: toggleSort }} />
                  <SortHeader
                    label="Reported by"
                    k="reporter"
                    {...{ sortKey, sortDir, onSort: toggleSort }}
                  />
                  <SortHeader label="Part" k="part" {...{ sortKey, sortDir, onSort: toggleSort }} />
                  <SortHeader
                    label="Result"
                    k="result"
                    {...{ sortKey, sortDir, onSort: toggleSort }}
                  />
                  <th className="px-3 py-2">Likely from</th>
                  <th className="px-3 py-2">Notes</th>
                  <SortHeader
                    label="What happened"
                    k="outcome"
                    {...{ sortKey, sortDir, onSort: toggleSort }}
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-steel/15">
                {filtered.map(({ report: r, reporter, part, failed, outcome }) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-steel-dark">
                      {when(r.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-ink whitespace-nowrap">{reporter}</td>
                    <td className="px-3 py-2 min-w-40">
                      <span className="text-ink">{part}</span>
                      <span className="block font-mono text-xs text-steel">
                        {r.partNumber}
                        {r.revision ? ` · Rev ${r.revision}` : ""} · {r.processName}
                      </span>
                    </td>
                    <td className="px-3 py-2 min-w-44">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                          r.passed
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                            : "bg-red-50 text-red-700 border-red-300"
                        }`}
                      >
                        {r.passed ? "Passed" : "Problem"}
                      </span>
                      {failed.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 text-xs text-steel-dark">
                          {failed.map((label) => (
                            <li key={label}>✕ {label}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-52 text-xs">
                      {r.passed ? (
                        <span className="text-steel">—</span>
                      ) : (
                        <ul className="space-y-1">
                          {r.suspects.map((s) => (
                            <li key={s.processId}>
                              <span className="font-semibold text-ink">{s.name}</span>
                              <span className="block text-steel-dark">
                                {s.completedAt
                                  ? `Finished ${when(s.completedAt)}${s.completedBy ? ` by ${resolveName(s.completedBy)}` : ""}`
                                  : "No finish recorded"}
                              </span>
                            </li>
                          ))}
                          {r.unsure ? <li className="text-steel-dark">Unsure</li> : null}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-48 max-w-80 text-ink whitespace-pre-wrap break-words">
                      {r.notes || <span className="text-steel">—</span>}
                    </td>
                    <td className="px-3 py-2 min-w-44">
                      <span className="text-ink">{outcome}</span>
                      {r.outcome === "sent_back" && r.outcomeAt && (
                        <span className="block text-xs text-steel-dark">
                          {when(r.outcomeAt)}
                          {r.outcomeBy ? ` by ${resolveName(r.outcomeBy)}` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="text-sm text-steel px-3 py-4">No reports match these filters.</p>
            )}
          </div>
          <p className="text-xs text-steel">
            {filtered.length} of {reports.length} report{reports.length === 1 ? "" : "s"}
          </p>
        </div>
      )}
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
        className={`flex items-center gap-1 uppercase tracking-wider whitespace-nowrap ${
          active ? "text-crimson" : "hover:text-ink"
        }`}
      >
        {label}
        {active && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
