import { useState } from "react";
import { Link } from "react-router-dom";
import { type Report, consoleApi, formatTime, read, send, useLoad } from "./data";
import { Notice, StatusBadge, buttonClass, fieldClass } from "./shell";

// Reports that a team number was signed up by people who aren't that team (the public /report
// page). An operator writes back by email, then acts on the team and closes the report.

export function ReportsPage() {
  const [status, setStatus] = useState<"open" | "resolved" | "">("open");
  const reports = useLoad(
    () => read<Report[]>(consoleApi.reports.$get({ query: { status } })),
    [status],
  );
  return (
    <div className="space-y-4">
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value as typeof status)}
        className={`${fieldClass} w-40`}
      >
        <option value="open">Open</option>
        <option value="resolved">Resolved</option>
        <option value="">All</option>
      </select>
      {reports.error && <Notice>{reports.error}</Notice>}
      {reports.data?.map((r) => (
        <ReportCard key={r.id} report={r} onChange={reports.reload} />
      ))}
      {reports.data?.length === 0 && (
        <p className="py-6 text-center text-sm text-secondary-500">No reports.</p>
      )}
    </div>
  );
}

export function ReportCard({ report, onChange }: { report: Report; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const next = report.status === "open" ? "resolved" : "open";
  return (
    <article className="space-y-2 rounded-xl border border-line bg-surface p-4 text-sm shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-secondary-900">Team {report.teamNumber}</span>
        <StatusBadge status={report.status} />
        {report.teamId ? (
          <Link to={`/console/teams/${report.teamId}`} className="text-primary-600 hover:underline">
            {report.teamName}
          </Link>
        ) : (
          report.teamId === null && (
            <span className="text-secondary-500">No team holds this number now</span>
          )
        )}
        <span className="ml-auto text-secondary-500">{formatTime(report.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-secondary-800">{report.message}</p>
      <p className="text-secondary-600">
        From {report.name ? `${report.name}, ` : ""}
        <a href={`mailto:${report.email}`} className="text-primary-600 hover:underline">
          {report.email}
        </a>
      </p>
      {error && <Notice>{error}</Notice>}
      <button
        type="button"
        className={buttonClass()}
        onClick={async () => {
          try {
            await send("POST", `/reports/${report.id}`, { status: next });
            onChange();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {next === "resolved" ? "Mark resolved" : "Reopen"}
      </button>
    </article>
  );
}
