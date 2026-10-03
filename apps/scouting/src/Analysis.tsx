import { site } from "@g3/site-config";
import {
  BarChart3,
  ChevronDown,
  Map as MapIcon,
  Scale,
  Search,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { type SyntheticEvent, useEffect, useState } from "react";
import type { ScoutingField } from "./ScoutingForms";
import { TeamLookupInput } from "./TeamLookupInput";
import { API_URL, api } from "./api";

type Report = {
  id: string;
  teamName: string;
  formName: string;
  fields: ScoutingField[];
  answers: Record<string, unknown>;
  drawings: Record<string, string>;
  submittedByName: string;
  createdAt: number;
  eventKey?: string;
  matchKey?: string;
  matchNumber?: number;
  starredFieldIds: string[];
  archivedAt?: number | null;
  archiveReason?: string;
};
type TeamMatch = {
  key: string;
  label: string;
  scheduledAt: number | null;
  alliance: "red" | "blue";
  redTeams: string[];
  blueTeams: string[];
  redScore: number;
  blueScore: number;
  /** Whether this team played with or against our team. */
  relationToTeam: "with" | "against" | "none";
  played: boolean;
};
type TeamComment = {
  id: string;
  team_name: string;
  comment: string;
  event_key?: string;
  created_by_name: string;
  created_at: number;
};

const AUTO_PATH_COLORS = [
  [255, 51, 79],
  [53, 208, 111],
  [255, 212, 59],
  [255, 102, 196],
  [229, 57, 53],
  [46, 125, 50],
  [249, 168, 37],
  [236, 64, 122],
];

function imageHasAutoPath(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return true;
  try {
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let matchingSamples = 0;
    for (let y = 0; y < canvas.height; y += 4) {
      for (let x = 0; x < canvas.width; x += 4) {
        const offset = (y * canvas.width + x) * 4;
        const matches = AUTO_PATH_COLORS.some(([red, green, blue]) => {
          const redDifference = pixels[offset] - red;
          const greenDifference = pixels[offset + 1] - green;
          const blueDifference = pixels[offset + 2] - blue;
          return (
            redDifference * redDifference +
              greenDifference * greenDifference +
              blueDifference * blueDifference <
            1600
          );
        });
        if (matches && ++matchingSamples >= 6) return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

export function Analysis({ initialReportId }: { initialReportId?: string | null }) {
  const [team, setTeam] = useState("");
  const [searched, setSearched] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [teamB, setTeamB] = useState("");
  const [searchedB, setSearchedB] = useState("");
  const [reportsB, setReportsB] = useState<Report[]>([]);
  const [teamMatches, setTeamMatches] = useState<TeamMatch[]>([]);
  const [teamComments, setTeamComments] = useState<TeamComment[]>([]);
  const [competition, setCompetition] = useState("all");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [blankPathIds, setBlankPathIds] = useState<Set<string>>(() => new Set());
  const [reportSort, setReportSort] = useState<"team" | "match" | "newest" | "starred">("team");
  const [tab, setTab] = useState<"stats" | "matches" | "auto" | "compare">("stats");
  const [expandedReportId, setExpandedReportId] = useState<string | null>(initialReportId ?? null);
  const [selectedPath, setSelectedPath] = useState<{
    url: string;
    teamName: string;
    label: string;
  } | null>(null);

  async function loadData(teamFilter = team, teamBFilter = teamB) {
    setLoading(true);
    setLoadError("");
    try {
      const result = await api<{
        reports: Report[];
        teamMatches: TeamMatch[];
        teamComments: TeamComment[];
      }>(
        `/analysis?team=${encodeURIComponent(teamFilter)}${tab === "compare" ? `&teamB=${encodeURIComponent(teamBFilter)}` : ""}`,
      );
      setReports(
        teamFilter
          ? result.reports.filter(
              (report) => report.teamName.toLowerCase() === teamFilter.toLowerCase(),
            )
          : result.reports,
      );
      setBlankPathIds(new Set());
      setCompetition("all");
      setSearched(teamFilter);
      setSearchedB(tab === "compare" ? teamBFilter : "");
      setTeamComments(result.teamComments);
      setTeamMatches(result.teamMatches);
      setReportsB(
        tab === "compare"
          ? result.reports.filter(
              (report) => report.teamName.toLowerCase() === teamBFilter.toLowerCase(),
            )
          : [],
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load analysis data.");
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }

  async function search(event: SyntheticEvent) {
    event.preventDefault();
    await loadData();
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: this intentionally loads the unfiltered directory once on mount.
  useEffect(() => {
    loadData("", "").catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!loaded || !initialReportId) return;
    setExpandedReportId(initialReportId);
    window.setTimeout(() => {
      document.getElementById(`report-${initialReportId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 0);
  }, [initialReportId, loaded]);
  useEffect(() => {
    if (!selectedPath) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedPath(null);
    };
    document.body.classList.add("analysis-path-open");
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("analysis-path-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedPath]);

  async function permanentlyDeleteReport(report: Report) {
    if (
      !window.confirm(
        `Permanently delete this report for team ${report.teamName}? This cannot be undone.`,
      )
    )
      return;
    if (!window.confirm("Confirm permanent deletion one more time.")) return;
    await api(`/analysis/reports/${report.id}/permanent`, { method: "DELETE" });
    setReports((items) => items.filter((item) => item.id !== report.id));
    setReportsB((items) => items.filter((item) => item.id !== report.id));
  }

  async function toggleStar(report: Report, fieldId: string) {
    const result = await api<{ starredFieldIds: string[] }>(
      `/analysis/reports/${report.id}/stars`,
      {
        method: "PUT",
        body: JSON.stringify({ fieldId, starred: !report.starredFieldIds.includes(fieldId) }),
      },
    );
    const update = (items: Report[]) =>
      items.map((item) =>
        item.id === report.id ? { ...item, starredFieldIds: result.starredFieldIds } : item,
      );
    setReports(update);
    setReportsB(update);
  }

  function numericSummary(items: Report[]) {
    const values = new Map<string, number[]>();
    for (const report of items) {
      for (const field of report.fields) {
        const value = report.answers[field.id];
        if ((field.type === "counter" || field.type === "slider") && typeof value === "number") {
          values.set(field.label, [...(values.get(field.label) ?? []), value]);
        }
      }
    }
    return new Map(
      [...values].map(([label, samples]) => [
        label,
        samples.reduce((sum, value) => sum + value, 0) / samples.length,
      ]),
    );
  }

  const activeReports = reports.filter((report) => !report.archivedAt);
  const activeReportsB = reportsB.filter((report) => !report.archivedAt);
  const summaryA = numericSummary(activeReports);
  const summaryB = numericSummary(activeReportsB);
  const comparisonLabels = [...new Set([...summaryA.keys(), ...summaryB.keys()])];
  const competitions = [
    ...new Set([
      ...reports.map((report) => report.eventKey || "Unassigned"),
      ...teamComments.map((comment) => comment.event_key || "Unassigned"),
    ]),
  ].sort();
  const visibleReports = reports
    .filter((report) => competition === "all" || (report.eventKey || "Unassigned") === competition)
    .sort((left, right) => {
      if (reportSort === "team") {
        const leftTeam = Number(left.teamName);
        const rightTeam = Number(right.teamName);
        const teamOrder =
          Number.isFinite(leftTeam) && Number.isFinite(rightTeam)
            ? leftTeam - rightTeam
            : left.teamName.localeCompare(right.teamName, undefined, { numeric: true });
        return teamOrder || right.createdAt - left.createdAt;
      }
      if (reportSort === "newest") return right.createdAt - left.createdAt;
      if (reportSort === "starred") {
        const starOrder =
          Number(right.starredFieldIds.length > 0) - Number(left.starredFieldIds.length > 0);
        if (starOrder !== 0) return starOrder;
        return right.createdAt - left.createdAt;
      }
      const eventOrder = (left.eventKey || "Unassigned").localeCompare(
        right.eventKey || "Unassigned",
      );
      if (eventOrder !== 0) return eventOrder;
      const leftDay = new Date(left.createdAt).setHours(0, 0, 0, 0);
      const rightDay = new Date(right.createdAt).setHours(0, 0, 0, 0);
      const dayOrder = rightDay - leftDay;
      if (dayOrder !== 0) return dayOrder;
      const matchOrder =
        (left.matchNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.matchNumber ?? Number.MAX_SAFE_INTEGER);
      if (matchOrder !== 0) return matchOrder;
      const teamOrder = Number(left.teamName) - Number(right.teamName);
      if (teamOrder !== 0) return teamOrder;
      const starOrder =
        Number(right.starredFieldIds.length > 0) - Number(left.starredFieldIds.length > 0);
      return starOrder || right.createdAt - left.createdAt;
    });
  const visibleActiveReports = visibleReports.filter((report) => !report.archivedAt);
  const visibleSummary = numericSummary(visibleActiveReports);
  const summaryMetrics = [...visibleSummary]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 6);
  const coveredMatches = new Set(
    visibleActiveReports.flatMap((report) => (report.matchNumber ? [report.matchNumber] : [])),
  ).size;
  const scoutCount = new Set(visibleActiveReports.map((report) => report.submittedByName)).size;
  const highlightedReports = visibleActiveReports.filter(
    (report) => report.starredFieldIds.length > 0,
  ).length;

  const autoFields = activeReports
    .filter((report) => competition === "all" || (report.eventKey || "Unassigned") === competition)
    .flatMap((report) =>
      report.fields
        .filter((field) => field.type === "fieldMap" && report.drawings[field.id])
        .map((field) => ({ report, field, url: report.drawings[field.id] })),
    );
  const visibleAutoFields = autoFields.filter(
    ({ report, field }) => !blankPathIds.has(`${report.id}-${field.id}`),
  );
  const visibleComments = teamComments
    .filter(
      (comment) => competition === "all" || (comment.event_key || "Unassigned") === competition,
    )
    .sort((left, right) => {
      const eventOrder = (left.event_key || "Unassigned").localeCompare(
        right.event_key || "Unassigned",
      );
      return eventOrder || right.created_at - left.created_at;
    });
  const commentsByTeam = new Map<string, TeamComment[]>();
  for (const comment of visibleComments) {
    commentsByTeam.set(comment.team_name, [
      ...(commentsByTeam.get(comment.team_name) ?? []),
      comment,
    ]);
  }
  return (
    <section className="page analysis-page">
      <div className="page-heading">
        <div>
          <h1>Analysis</h1>
          <span>{searched ? `Team ${searched}` : `${reports.length} scouting reports`}</span>
        </div>
      </div>
      <form className="analysis-search" onSubmit={search}>
        <Search size={19} />
        <TeamLookupInput
          required={tab === "compare"}
          value={team}
          onChange={setTeam}
          placeholder={tab === "compare" ? "Team A number or name" : "Team number or name"}
        />
        {tab === "compare" && (
          <>
            <Scale size={18} />
            <TeamLookupInput
              required
              value={teamB}
              onChange={setTeamB}
              placeholder="Team B number or name"
            />
          </>
        )}
        <button type="submit" className="primary-button">
          {loading ? "Loadingâ€¦" : tab === "compare" ? "Compare" : team ? "Find team" : "Show all"}
        </button>
        {(team || searched || teamB || searchedB) && (
          <button
            type="button"
            className="secondary-button analysis-clear"
            onClick={() => {
              setTeam("");
              setTeamB("");
              setSearchedB("");
              void loadData("", "");
            }}
            aria-label="Clear team filters"
            title="Clear team filters"
          >
            <X size={17} />
          </button>
        )}
      </form>
      {loadError && (
        <div className="analysis-error" role="alert">
          {loadError}
        </div>
      )}
      <div className="analysis-tabs">
        <button
          type="button"
          className={tab === "matches" ? "active" : ""}
          onClick={() => setTab("matches")}
        >
          Matches
        </button>
        <button
          type="button"
          className={tab === "stats" ? "active" : ""}
          onClick={() => setTab("stats")}
        >
          Stats
        </button>
        <button
          type="button"
          className={tab === "auto" ? "active" : ""}
          onClick={() => setTab("auto")}
        >
          Auto path
        </button>
        <button
          type="button"
          className={tab === "compare" ? "active" : ""}
          onClick={() => setTab("compare")}
        >
          Compare
        </button>
      </div>
      {tab === "stats" ? (
        <div className="analysis-results-stack">
          <div className="analysis-controls">
            {competitions.length > 0 && (
              <label className="competition-filter">
                Competition
                <select
                  value={competition}
                  onChange={(event) => setCompetition(event.target.value)}
                >
                  <option value="all">All competitions</option>
                  {competitions.map((eventKey) => (
                    <option value={eventKey} key={eventKey}>
                      {eventKey}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="competition-filter">
              Sort reports
              <select
                value={reportSort}
                onChange={(event) =>
                  setReportSort(event.target.value as "team" | "match" | "newest" | "starred")
                }
              >
                <option value="team">Team number, newest first</option>
                <option value="match">Competition and match</option>
                <option value="newest">Newest first</option>
                <option value="starred">Highlights first</option>
              </select>
            </label>
          </div>
          {loaded && visibleActiveReports.length > 0 && (
            <section className="analysis-overview" aria-label="Scouting summary">
              <div>
                <BarChart3 size={18} />
                <strong>{visibleActiveReports.length}</strong>
                <span>Reports</span>
              </div>
              <div>
                <Scale size={18} />
                <strong>{coveredMatches}</strong>
                <span>Matches</span>
              </div>
              <div>
                <Users size={18} />
                <strong>{scoutCount}</strong>
                <span>Scouts</span>
              </div>
              <div>
                <Star size={18} />
                <strong>{highlightedReports}</strong>
                <span>Highlights</span>
              </div>
              {summaryMetrics.map(([label, average]) => (
                <div className="analysis-average" key={label}>
                  <strong>{average.toFixed(1)}</strong>
                  <span>{label}</span>
                  <small>Average</small>
                </div>
              ))}
            </section>
          )}
          {loaded && !reports.length && !teamComments.length && (
            <div className="forms-empty">
              {searched ? `No reports found for team ${searched}.` : "No reports found."}
            </div>
          )}
          {commentsByTeam.size > 0 && (
            <section className="team-comment-directory">
              {[...commentsByTeam].map(([teamNumber, comments]) => (
                <article key={teamNumber}>
                  <h2>Team {teamNumber}</h2>
                  {comments.map((comment) => (
                    <div key={comment.id}>
                      <p>{comment.comment}</p>
                      <small>
                        {comment.event_key || "Unassigned"} · {comment.created_by_name} ·{" "}
                        {new Date(comment.created_at).toLocaleString()}
                      </small>
                    </div>
                  ))}
                </article>
              ))}
            </section>
          )}
          <div className="analysis-reports">
            {visibleReports.map((report) => {
              const expanded = expandedReportId === report.id;
              return (
                <div className={`report-result ${expanded ? "expanded" : ""}`} key={report.id}>
                  <article
                    id={`report-${report.id}`}
                    className={`${report.starredFieldIds.length ? "starred-report" : ""} ${report.archivedAt ? "archived-report" : ""}`}
                  >
                    <button
                      type="button"
                      className="report-summary-button"
                      aria-expanded={expanded}
                      aria-controls={`report-details-${report.id}`}
                      onClick={() => setExpandedReportId(expanded ? null : report.id)}
                    >
                      <span>
                        <strong>Team {report.teamName}</strong>
                        <small>{report.formName}</small>
                      </span>
                      <strong className="report-match-number">
                        {report.matchNumber ? `Match ${report.matchNumber}` : "No match"}
                      </strong>
                      <ChevronDown size={18} className={expanded ? "expanded" : ""} />
                    </button>
                    {expanded && (
                      <div className="report-details" id={`report-details-${report.id}`}>
                        <header>
                          <div className="report-metadata">
                            <span>{report.eventKey || "Unassigned competition"}</span>
                            <span>{report.submittedByName}</span>
                            <time>{new Date(report.createdAt).toLocaleString()}</time>
                          </div>
                          <button
                            type="button"
                            className={`star-button ${report.starredFieldIds.includes("__report") ? "active" : ""}`}
                            onClick={() => toggleStar(report, "__report")}
                            aria-label={
                              report.starredFieldIds.includes("__report")
                                ? `Unstar team ${report.teamName} report`
                                : `Star team ${report.teamName} report`
                            }
                            title={
                              report.starredFieldIds.includes("__report")
                                ? "Unstar report"
                                : "Star report"
                            }
                          >
                            <Star size={16} fill="currentColor" />
                          </button>
                          <button
                            type="button"
                            className="delete-report-button"
                            onClick={() => permanentlyDeleteReport(report)}
                            aria-label={`Permanently delete report for ${report.teamName}`}
                            title="Remove bad data"
                          >
                            <Trash2 size={17} />
                          </button>
                        </header>
                        <dl>
                          {report.fields
                            .filter((field) => field.type !== "fieldMap")
                            .map((field) => (
                              <div
                                className={
                                  report.starredFieldIds.includes(field.id) ? "starred-answer" : ""
                                }
                                key={field.id}
                              >
                                <dt>{field.label}</dt>
                                <dd>
                                  {Array.isArray(report.answers[field.id])
                                    ? (report.answers[field.id] as unknown[]).join(", ")
                                    : String(report.answers[field.id] ?? "—")}
                                </dd>
                                <button
                                  type="button"
                                  className={`star-button ${report.starredFieldIds.includes(field.id) ? "active" : ""}`}
                                  onClick={() => toggleStar(report, field.id)}
                                  aria-label={
                                    report.starredFieldIds.includes(field.id)
                                      ? `Remove highlight from ${field.label}`
                                      : `Highlight ${field.label}`
                                  }
                                  title={
                                    report.starredFieldIds.includes(field.id)
                                      ? "Remove highlight"
                                      : "Highlight answer"
                                  }
                                >
                                  <Star size={15} fill="currentColor" />
                                </button>
                              </div>
                            ))}
                        </dl>
                      </div>
                    )}
                  </article>
                </div>
              );
            })}
          </div>
        </div>
      ) : tab === "matches" ? (
        <div className="match-history">
          {teamMatches.map((match) => (
            <article key={match.key} className={match.relationToTeam !== "none" ? "g3-match" : ""}>
              <header>
                <strong>{match.label}</strong>
                {match.relationToTeam !== "none" && (
                  <span>
                    Played {match.relationToTeam} Team {site.team.number}
                  </span>
                )}
              </header>
              <div className="match-score">
                <span className={match.alliance === "red" ? "searched-alliance" : ""}>
                  Red: {match.redTeams.join(", ")}
                  <b>{match.played ? match.redScore : "—"}</b>
                </span>
                <span className={match.alliance === "blue" ? "searched-alliance" : ""}>
                  Blue: {match.blueTeams.join(", ")}
                  <b>{match.played ? match.blueScore : "—"}</b>
                </span>
              </div>
              {match.scheduledAt && <time>{new Date(match.scheduledAt).toLocaleString()}</time>}
            </article>
          ))}
          {searched && !teamMatches.length && (
            <div className="forms-empty">No TBA matches found.</div>
          )}
          {loaded && !searched && (
            <div className="forms-empty">Enter a team number to load its TBA matches.</div>
          )}
        </div>
      ) : tab === "auto" ? (
        <div className="analysis-results-stack">
          {competitions.length > 0 && (
            <label className="competition-filter">
              Competition
              <select value={competition} onChange={(event) => setCompetition(event.target.value)}>
                <option value="all">All competitions</option>
                {competitions.map((eventKey) => (
                  <option value={eventKey} key={eventKey}>
                    {eventKey}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="auto-path-grid">
            {visibleAutoFields.map(({ report, field, url }) => {
              const pathId = `${report.id}-${field.id}`;
              return (
                <article key={pathId}>
                  <button
                    type="button"
                    className="auto-path-image-link"
                    aria-label={`Open full-size path for team ${report.teamName}`}
                    title="Open full-size drawing"
                    onClick={() =>
                      setSelectedPath({
                        url: `${API_URL}${url}`,
                        teamName: report.teamName,
                        label: field.label,
                      })
                    }
                  >
                    <img
                      src={`${API_URL}${url}`}
                      alt={`${report.teamName} ${field.label}`}
                      crossOrigin="use-credentials"
                      onLoad={(event) => {
                        if (imageHasAutoPath(event.currentTarget)) return;
                        setBlankPathIds((current) => new Set(current).add(pathId));
                      }}
                    />
                  </button>
                  <div>
                    <MapIcon size={16} />
                    <strong>
                      Team {report.teamName} · {field.label}
                    </strong>
                    <span>
                      {report.eventKey || "Unassigned"} · {report.formName} ·{" "}
                      {new Date(report.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="delete-report-button"
                    onClick={() => permanentlyDeleteReport(report)}
                    aria-label={`Permanently delete report for ${report.teamName}`}
                    title="Remove bad data"
                  >
                    <Trash2 size={17} />
                  </button>
                </article>
              );
            })}
            {loaded && !visibleAutoFields.length && (
              <div className="forms-empty">
                No autonomous paths reported{searched ? ` for ${searched}` : ""}.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="team-comparison">
          {searched && searchedB && (
            <div className="comparison-scoreboard">
              <div>
                <span>Team A</span>
                <strong>{searched}</strong>
                <small>{activeReports.length} reports</small>
              </div>
              <Scale size={28} />
              <div>
                <span>Team B</span>
                <strong>{searchedB}</strong>
                <small>{activeReportsB.length} reports</small>
              </div>
            </div>
          )}
          {comparisonLabels.map((label) => {
            const left = summaryA.get(label);
            const right = summaryB.get(label);
            const winner =
              left === undefined || right === undefined || left === right
                ? "tie"
                : left > right
                  ? "left"
                  : "right";
            return (
              <div className="comparison-row" key={label}>
                <strong className={winner === "left" ? "winner" : ""}>
                  {left?.toFixed(1) ?? "—"}
                </strong>
                <span>
                  {label}
                  <small>average reported value</small>
                </span>
                <strong className={winner === "right" ? "winner" : ""}>
                  {right?.toFixed(1) ?? "—"}
                </strong>
              </div>
            );
          })}
          {searched && !comparisonLabels.length && (
            <div className="forms-empty">No comparable slider or counter data was found.</div>
          )}
        </div>
      )}
      {selectedPath && (
        <div
          className="auto-path-dialog-backdrop"
          role="presentation"
          onClick={() => setSelectedPath(null)}
        >
          <div
            className="auto-path-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auto-path-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h2 id="auto-path-dialog-title">
                Team {selectedPath.teamName} · {selectedPath.label}
              </h2>
              <button
                type="button"
                aria-label="Close path viewer"
                title="Close"
                onClick={() => setSelectedPath(null)}
              >
                <X size={22} />
              </button>
            </header>
            <img
              src={selectedPath.url}
              alt={`Team ${selectedPath.teamName} ${selectedPath.label}`}
            />
          </div>
        </div>
      )}
    </section>
  );
}
