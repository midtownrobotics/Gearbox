import { ErrorBanner, TextField } from "@g3/ui";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { fetchQualityReports, saveQualityChecklist } from "../../shared/getters";
import { InfoTip } from "../../shared/info-tip";
import { MAX_CHECKLIST_ITEMS, MAX_CHECK_LABEL, type QualityReport } from "../../shared/types";
import { useRefreshAuthUser } from "../../shared/use-auth";
import { useUserNames } from "../../shared/use-user-names";
import { sectionHeading } from "./admin-styles";

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

/** The lines of its checklist a report says the part failed. */
function failedChecks(r: QualityReport) {
  return r.checks.filter((c) => !c.ok).map((c) => c.label);
}

/** What happened to the part after the report. */
function outcomeLabel(r: QualityReport) {
  if (r.outcome === "passed") return "Passed";
  if (r.outcome === "not_sent_back") return "Not sent back";
  if (r.outcome === "replaced") {
    return r.replacementInstanceNumber
      ? `Started over as #${r.replacementInstanceNumber}`
      : "Started over";
  }
  const status = r.sentBackStatus ? ` (${STATUS_LABELS[r.sentBackStatus]})` : "";
  if (r.outcome === "fixed") return `Fixed at ${r.sentBackProcessName}${status}`;
  return `Sent back to ${r.sentBackProcessName}${status}`;
}

/**
 * The Quality Reports section: whether Quality Control steps are finished with a report, and every
 * report the team has made, searchable, filterable and sortable.
 */
export function QualityReports() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [checklist, setChecklist] = useState<string[] | null>(null);
  const [reports, setReports] = useState<QualityReport[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshAuth = useRefreshAuthUser();

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
        const state = (await res.json()) as { qualityReports: boolean; checklist: string[] };
        setEnabled(state.qualityReports);
        setChecklist(state.checklist);
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
      // The shop floor reads this from /me, so it has to hear about the change.
      refreshAuth();
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
    "bg-surface border border-secondary-300 rounded-lg px-2.5 py-2 text-sm text-secondary-900 focus:outline-none focus:border-primary-500";

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}

      {enabled !== null && (
        <div className="flex items-center gap-2 text-sm text-secondary-900">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(e) => toggle(e.target.checked)}
              className="accent-primary-500 w-4 h-4"
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
        !error && <p className="text-sm text-secondary-500">Loading reports…</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-secondary-500">No quality reports yet.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <TextField
              variant="search"
              placeholder="Search reports…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-40"
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
              <option value="fixed">Fixed</option>
              <option value="replaced">Started over</option>
              <option value="not_sent_back">Not sent back</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-secondary-500">
              From
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className={selectClass}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-secondary-500">
              To
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className={selectClass}
              />
            </label>
          </div>

          <div className="border border-secondary-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-inset text-left text-xs font-semibold uppercase tracking-wider text-secondary-500">
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
              <tbody className="divide-y divide-secondary-200">
                {filtered.map(({ report: r, reporter, part, failed, outcome }) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-secondary-600">
                      {when(r.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-secondary-900 whitespace-nowrap">{reporter}</td>
                    <td className="px-3 py-2 min-w-40">
                      <span className="text-secondary-900">{part}</span>
                      <span className="block font-mono text-xs text-secondary-500">
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
                        <ul className="mt-1.5 space-y-0.5 text-xs text-secondary-600">
                          {failed.map((label) => (
                            <li key={label}>✕ {label}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-52 text-xs">
                      {r.passed ? (
                        <span className="text-secondary-500">—</span>
                      ) : (
                        <ul className="space-y-1">
                          {r.suspects.map((s) => (
                            <li key={s.processId}>
                              <span className="font-semibold text-secondary-900">{s.name}</span>
                              <span className="block text-secondary-600">
                                {s.completedAt
                                  ? `Finished ${when(s.completedAt)}${s.completedBy ? ` by ${resolveName(s.completedBy)}` : ""}`
                                  : "No finish recorded"}
                              </span>
                            </li>
                          ))}
                          {r.unsure ? <li className="text-secondary-600">Unsure</li> : null}
                        </ul>
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-48 max-w-80 text-secondary-900 whitespace-pre-wrap break-words">
                      {r.notes || <span className="text-secondary-500">—</span>}
                    </td>
                    <td className="px-3 py-2 min-w-44">
                      <span className="text-secondary-900">{outcome}</span>
                      {r.outcome !== "not_sent_back" && r.outcomeAt && (
                        <span className="block text-xs text-secondary-600">
                          {when(r.outcomeAt)}
                          {r.outcomeBy ? ` by ${resolveName(r.outcomeBy)}` : ""}
                        </span>
                      )}
                      {r.fixNote && (
                        <span className="block text-xs text-secondary-600 whitespace-pre-wrap">
                          {r.fixNote}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="text-sm text-secondary-500 px-3 py-4">
                No reports match these filters.
              </p>
            )}
          </div>
          <p className="text-xs text-secondary-500">
            {filtered.length} of {reports.length} report{reports.length === 1 ? "" : "s"}
          </p>
        </div>
      )}

      {checklist && <Checklist saved={checklist} onSaved={setChecklist} />}
    </div>
  );
}

/**
 * The checklist every report goes through: one line per question, in the order reporters see
 * them. Reports already written keep the lines they were answered against.
 */
function Checklist({ saved, onSaved }: { saved: string[]; onSaved: (next: string[]) => void }) {
  const [lines, setLines] = useState<string[]>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleaned = lines.map((l) => l.trim()).filter(Boolean);
  const changed = cleaned.join("\n") !== saved.join("\n");
  const duplicate = new Set(cleaned.map((l) => l.toLowerCase())).size !== cleaned.length;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await saveQualityChecklist(cleaned);
      setLines(next);
      onSaved(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The checklist didn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-secondary-200 pt-4">
      <div>
        <h3 className={sectionHeading}>Checklist</h3>
        <p className="text-xs text-secondary-500 mt-1">
          What a shop manager checks the part against. A report passes only when every line is
          ticked.
        </p>
      </div>

      <div className="space-y-2 max-w-xl">
        {lines.map((line, i) => (
          // The row's place in the list is its identity: the text is what's being edited.
          // biome-ignore lint/suspicious/noArrayIndexKey: the index is the row
          <div key={i} className="flex items-center gap-2">
            <TextField
              kind="checklist"
              aria-label={`Checklist line ${i + 1}`}
              value={line}
              maxLength={MAX_CHECK_LABEL}
              disabled={busy}
              onChange={(e) => setLines(lines.map((l, j) => (j === i ? e.target.value : l)))}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
              aria-label={`Remove line ${i + 1}`}
              title="Remove this line"
              className="text-secondary-500 hover:text-red-600 px-1 transition-colors disabled:opacity-50"
            >
              ✕
            </button>
          </div>
        ))}
        {lines.length === 0 && (
          <p className="text-sm text-secondary-500">
            A checklist needs at least one line before anyone can report.
          </p>
        )}
      </div>

      {duplicate && <p className="text-xs text-amber-700">Two lines say the same thing.</p>}
      {error && <ErrorBanner message={error} />}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || lines.length >= MAX_CHECKLIST_ITEMS}
          onClick={() => setLines([...lines, ""])}
          className="px-3 py-2 rounded-lg border border-secondary-300 text-sm font-semibold text-secondary-900 hover:bg-secondary-50 transition-colors disabled:opacity-50"
        >
          Add a line
        </button>
        <button
          type="button"
          disabled={busy || !changed || cleaned.length === 0 || duplicate}
          onClick={save}
          className="px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-on-primary text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save checklist"}
        </button>
        {changed && !busy && (
          <button
            type="button"
            onClick={() => setLines(saved)}
            className="text-sm text-secondary-500 hover:text-secondary-900 transition-colors"
          >
            Undo changes
          </button>
        )}
      </div>
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
          active ? "text-primary-600" : "hover:text-secondary-900"
        }`}
      >
        {label}
        {active && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
