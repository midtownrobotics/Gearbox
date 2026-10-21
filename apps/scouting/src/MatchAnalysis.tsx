import { useState } from "react";
import { AnalysisAutoPaths } from "./AnalysisAutoPaths";
import type { AutoPath } from "./analysis-auto-paths";
import { type Report, answerText, newestFirst } from "./analysis-table";
import { API_URL, api } from "./api";

export type TeamMatch = {
  key: string;
  label: string;
  scheduledAt: number | null;
  alliance: "red" | "blue";
  redTeams: string[];
  blueTeams: string[];
  redScore: number;
  blueScore: number;
  relationToTeam: "with" | "against" | "none";
  played: boolean;
};

export function MatchAnalysis({
  match,
  onView,
  onDelete,
  canManageReports,
  eventLabel,
}: {
  match: TeamMatch;
  onView(path: AutoPath): void;
  onDelete(report: Report): Promise<void>;
  canManageReports: boolean;
  eventLabel(key?: string): string;
}) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ reports: Report[] }>(
        `/analysis?matchKey=${encodeURIComponent(match.key)}`,
      );
      setReports(newestFirst(result.reports));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load match reports.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <details
      className="rounded-xl border border-line bg-surface"
      onToggle={(event) => {
        if (event.currentTarget.open && reports === null && !loading) void load();
      }}
    >
      <summary className="cursor-pointer px-4 py-3 font-semibold">
        {match.label}
        <span className="ml-3 text-sm font-normal text-secondary-500">
          {match.played ? `Red ${match.redScore} · Blue ${match.blueScore}` : "Not scored"}
        </span>
      </summary>
      <div className="space-y-3 border-t border-line p-4">
        {match.scheduledAt && (
          <time className="text-xs text-secondary-500">
            {new Date(match.scheduledAt).toLocaleString()}
          </time>
        )}
        {loading && <p role="status">Loading scouting reports…</p>}
        {error && (
          <div role="alert">
            {error}{" "}
            <button type="button" className="underline" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}
        {reports !== null && (
          <p className="text-sm text-secondary-500">
            {reports.length} scouting reports. Select a team to see its answers.
          </p>
        )}
        {(["red", "blue"] as const).map((alliance) => (
          <section
            key={alliance}
            className={`space-y-2 border-l-4 pl-3 ${alliance === "red" ? "border-red-400" : "border-blue-400"}`}
          >
            <h3 className="text-sm font-semibold capitalize">{alliance} alliance</h3>
            {(alliance === "red" ? match.redTeams : match.blueTeams).map((team) => {
              const teamReports = (reports ?? []).filter((report) => report.teamName === team);
              const paths = teamReports.flatMap((report) =>
                report.fields
                  .filter(
                    (field) =>
                      field.type === "fieldMap" &&
                      (report.drawings[field.id] ||
                        report.answers[field.id] === "no-minimal-movement"),
                  )
                  .map((field) => ({ report, field, url: report.drawings[field.id] ?? "" })),
              );
              return (
                <details key={team} className="rounded-lg border border-line">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
                    Team {team}
                    <span className="ml-2 font-normal text-secondary-500">
                      {reports === null
                        ? ""
                        : teamReports.length
                          ? `${teamReports.length} reports`
                          : "No scouting data"}
                    </span>
                  </summary>
                  <div className="space-y-3 border-t border-line p-3">
                    {reports !== null && !teamReports.length && (
                      <p className="text-sm text-secondary-500">
                        No scouting report for this team in this match.
                      </p>
                    )}
                    {teamReports.map((report) => (
                      <article key={report.id} className="space-y-2">
                        <h4 className="text-sm font-semibold">
                          {report.formName}{" "}
                          <span className="font-normal text-secondary-500">
                            · {report.submittedByName}
                            {report.late ? " · Sent late" : ""}
                          </span>
                        </h4>
                        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                          {report.fields
                            .filter((field) => field.type !== "fieldMap")
                            .map((field) => (
                              <div key={field.id} className="contents">
                                <dt className="text-secondary-500">{field.label}</dt>
                                <dd className="whitespace-pre-wrap break-words">
                                  {answerText(report.answers[field.id]) || "—"}
                                </dd>
                              </div>
                            ))}
                        </dl>
                      </article>
                    ))}
                    {paths.length > 0 && (
                      <AnalysisAutoPaths
                        paths={paths}
                        loaded
                        searched={team}
                        eventLabel={eventLabel}
                        imageUrl={(url) => API_URL + url}
                        canManageReports={canManageReports}
                        onView={onView}
                        onImageLoad={() => {}}
                        onDelete={async (report) => {
                          await onDelete(report);
                          setReports(
                            (current) => current?.filter((item) => item.id !== report.id) ?? null,
                          );
                        }}
                      />
                    )}
                  </div>
                </details>
              );
            })}
          </section>
        ))}
      </div>
    </details>
  );
}
