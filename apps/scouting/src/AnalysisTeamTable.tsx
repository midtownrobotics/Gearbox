import { Badge, focusRing, tones } from "@g3/ui";
import { ChevronRight, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type Column,
  type Report,
  type Sort,
  type SortKey,
  type Summary,
  type TeamRow,
  answerText,
  columnsOf,
  firstDir,
  isNumeric,
  isText,
  matchLabel,
  sortRows,
  sortable,
  teamRows,
} from "./analysis-table";

export type TeamComment = {
  id: string;
  team_name: string;
  comment: string;
  event_key?: string;
  created_by_name: string;
  created_at: number;
};

type Props = {
  kind: "scouting" | "pit";
  /** The reports to show, all of `kind`. */
  reports: Report[];
  commentsByTeam: Map<string, TeamComment[]>;
  eventLabel: (key?: string) => string;
  /** A report to open its team's row at and mark. */
  focusReportId?: string | null;
  canManageReports: boolean;
  onToggleStar: (report: Report) => void;
  onDelete: (report: Report) => void;
  onViewDrawing: (drawing: { url: string; teamName: string; label: string }) => void;
};

const th = "px-3 py-2 text-left align-bottom text-xs font-semibold text-secondary-500";
const td = "px-3 py-2 align-top";
// The team's column stays in view while the table scrolls sideways.
const sticky = "sticky left-0 z-10";

/**
 * Every team with reports, one row each: on match scouting the average of each number and the
 * answer given most to each choice, on pit scouting the answers of the team's newest pit report.
 * A team's number opens its reports below its row, oldest first.
 */
export function AnalysisTeamTable(props: Props) {
  const { kind, reports, focusReportId } = props;
  const columns = columnsOf(reports);
  const [sort, setSort] = useState<Sort>({ key: "team", dir: "asc" });
  const focusTeam = reports.find((report) => report.id === focusReportId)?.teamName;
  const [opened, setOpened] = useState<Set<string>>(() => new Set(focusTeam ? [focusTeam] : []));
  const rows = sortRows(teamRows(reports, columns, kind), sort);
  // One team (a search for it) is shown open.
  const isOpen = (team: string) => rows.length === 1 || opened.has(team);

  // A report linked from elsewhere: open its team once and bring it into view.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!focusTeam || !focusReportId || scrolledTo.current === focusReportId) return;
    if (!opened.has(focusTeam)) {
      setOpened((current) => new Set(current).add(focusTeam));
      return;
    }
    scrolledTo.current = focusReportId;
    document
      .getElementById(`report-${focusReportId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusTeam, focusReportId, opened]);

  const onSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        : { key, dir: firstDir(key, columns) },
    );
  const toggle = (team: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(team)) next.add(team);
      return next;
    });

  const header = (key: SortKey, label: string, className = "", canSort = true) => (
    <th
      scope="col"
      key={key}
      aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
      className={`${th} ${className}`}
    >
      {canSort ? <SortButton k={key} label={label} sort={sort} onSort={onSort} /> : label}
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface text-sm">
      <table className="w-full border-collapse">
        <thead className="bg-page">
          <tr>
            {header("team", "Team", `${sticky} bg-page min-w-[8.5rem] md:min-w-[11rem]`)}
            {header("reports", "Reports", "text-right")}
            {columns.map((column) =>
              header(
                `field:${column.id}`,
                column.label,
                columnWidth(column, kind),
                sortable(column, kind),
              ),
            )}
          </tr>
        </thead>
        {rows.map((row) => (
          <TeamRows
            key={row.team}
            {...props}
            row={row}
            columns={columns}
            open={isOpen(row.team)}
            canClose={rows.length > 1}
            onToggle={() => toggle(row.team)}
          />
        ))}
      </table>
    </div>
  );
}

function columnWidth(column: Column, kind: Props["kind"]) {
  if (isNumeric(column)) return "min-w-[6rem] max-w-[10rem] text-right";
  if (isText(column)) return kind === "pit" ? "min-w-[16rem]" : "min-w-[12rem]";
  return "min-w-[7rem] max-w-[12rem]";
}

/** A team's row, and while it's open its reports and comments under it. */
function TeamRows({
  row,
  columns,
  open,
  canClose,
  onToggle,
  kind,
  commentsByTeam,
  eventLabel,
  focusReportId,
  canManageReports,
  onToggleStar,
  onDelete,
  onViewDrawing,
}: Props & {
  row: TeamRow;
  columns: Column[];
  open: boolean;
  canClose: boolean;
  onToggle: () => void;
}) {
  const comments = commentsByTeam.get(row.team) ?? [];
  const newest = row.reports[row.reports.length - 1];
  const manyEvents = new Set(row.reports.map((report) => report.eventKey ?? "")).size > 1;
  return (
    <tbody className="border-t border-line">
      <tr>
        <th scope="row" className={`${td} ${sticky} bg-surface text-left`}>
          <button
            type="button"
            aria-expanded={open}
            disabled={!canClose}
            onClick={onToggle}
            className={`inline-flex items-center gap-1 rounded text-base font-bold text-primary-700 hover:underline disabled:no-underline ${focusRing}`}
          >
            <ChevronRight
              size={16}
              aria-hidden
              className={`transition-transform ${open ? "rotate-90" : ""} ${canClose ? "" : "invisible"}`}
            />
            {row.team}
          </button>
        </th>
        <td className={`${td} text-right tabular-nums text-secondary-600`}>{row.reports.length}</td>
        {columns.map((column) => (
          <td key={column.id} className={`${td} ${isNumeric(column) ? "text-right" : ""}`}>
            {kind === "pit" ? (
              <AnswerCell
                report={newest}
                column={column}
                onViewDrawing={onViewDrawing}
                highlight={false}
              />
            ) : (
              <SummaryCell summary={row.summaries.get(column.id) ?? { kind: "none" }} />
            )}
          </td>
        ))}
      </tr>
      {open &&
        row.reports.map((report) => {
          const focused = report.id === focusReportId;
          const starred = report.starredFieldIds.includes("__report");
          return (
            <tr key={report.id} className={focused ? "bg-primary-50" : "bg-inset"}>
              <th
                scope="row"
                id={`report-${report.id}`}
                className={`${td} ${sticky} text-left font-normal ${focused ? "bg-primary-50" : "bg-inset"}`}
              >
                <div className="flex items-start gap-2 pl-5">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-secondary-900">
                      {kind === "pit"
                        ? new Date(report.createdAt).toLocaleDateString()
                        : matchLabel(report)}
                    </div>
                    <div className="text-xs text-secondary-500">
                      {report.submittedByName}
                      {manyEvents && ` · ${eventLabel(report.eventKey)}`}
                    </div>
                    {report.late && <Badge colors={tones.warning}>Sent late</Badge>}
                  </div>
                  {(canManageReports || starred) && (
                    <button
                      type="button"
                      disabled={!canManageReports}
                      onClick={() => onToggleStar(report)}
                      aria-pressed={starred}
                      aria-label={starred ? "Unstar report" : "Star report"}
                      title={starred ? "Unstar report" : "Star report"}
                      className={`rounded p-1 ${focusRing} ${starred ? "text-amber-500" : "text-secondary-400 hover:text-secondary-700"}`}
                    >
                      <Star size={15} fill={starred ? "currentColor" : "none"} />
                    </button>
                  )}
                  {canManageReports && (
                    <button
                      type="button"
                      onClick={() => onDelete(report)}
                      aria-label={`Permanently delete this report for team ${report.teamName}`}
                      title="Remove bad data"
                      className={`rounded p-1 text-secondary-400 hover:text-red-700 ${focusRing}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </th>
              <td className={td} />
              {columns.map((column) => (
                <td key={column.id} className={`${td} ${isNumeric(column) ? "text-right" : ""}`}>
                  <AnswerCell
                    report={report}
                    column={column}
                    onViewDrawing={onViewDrawing}
                    highlight={report.starredFieldIds.includes(column.id)}
                  />
                </td>
              ))}
            </tr>
          );
        })}
      {open && comments.length > 0 && (
        <tr className="bg-inset">
          <td colSpan={columns.length + 2} className={td}>
            <div className="sticky left-3 grid max-w-[min(48rem,calc(100vw-4rem))] gap-2 pl-5">
              <div className="text-xs font-semibold text-secondary-500">Comments</div>
              {comments.map((comment) => (
                <div key={comment.id}>
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{comment.comment}</p>
                  <p className="text-xs text-secondary-500">
                    {eventLabel(comment.event_key)} · {comment.created_by_name} ·{" "}
                    {new Date(comment.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </tbody>
  );
}

/** A team's average or most-given answer: "3.5", "No 4/7". Text answers stay in the reports. */
function SummaryCell({ summary }: { summary: Summary }) {
  if (summary.kind === "number") {
    return (
      <span
        className="font-semibold tabular-nums text-secondary-900"
        title={`Average of ${summary.count} report${summary.count === 1 ? "" : "s"}`}
      >
        {summary.average.toFixed(1)}
      </span>
    );
  }
  if (summary.kind === "choice") {
    return (
      <span title={`${summary.times} of ${summary.count} reports`}>
        <span className="font-semibold text-secondary-900">{summary.answer}</span>{" "}
        <span className="tabular-nums text-secondary-500">
          {summary.times}/{summary.count}
        </span>
      </span>
    );
  }
  return null;
}

/** One report's answer to one question; a drawing as a button that opens it. */
function AnswerCell({
  report,
  column,
  highlight,
  onViewDrawing,
}: {
  report: Report;
  column: Column;
  highlight: boolean;
  onViewDrawing: Props["onViewDrawing"];
}) {
  if (column.type === "fieldMap") {
    const url = report.drawings[column.id];
    if (!url) return null;
    return (
      <button
        type="button"
        onClick={() => onViewDrawing({ url, teamName: report.teamName, label: column.label })}
        className={`rounded font-semibold text-primary-700 hover:underline ${focusRing}`}
      >
        View
      </button>
    );
  }
  const text = answerText(report.answers[column.id]);
  return (
    <span
      title={highlight ? "Highlighted" : undefined}
      className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${isNumeric(column) ? "tabular-nums" : ""} ${
        highlight ? "rounded bg-amber-50 px-1 ring-1 ring-amber-300" : ""
      }`}
    >
      {text}
    </span>
  );
}

/** A column's name, which sorts by it; again to turn the order round. */
function SortButton({
  k,
  label,
  sort,
  onSort,
}: {
  k: SortKey;
  label: string;
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={`inline-flex items-end gap-1 rounded py-1 text-left font-semibold ${focusRing} ${
        active ? "text-secondary-900" : "hover:text-secondary-900"
      }`}
    >
      <span>{label}</span>
      <span aria-hidden className={active ? "" : "invisible"}>
        {sort.dir === "asc" || !active ? "↑" : "↓"}
      </span>
    </button>
  );
}
