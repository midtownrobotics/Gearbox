import { pageTeamNumber } from "@g3/site-config";
import { Button, Chip, Page as SharedPage, inputClass, useQuestions } from "@g3/ui";
import { BarChart3, Map as MapIcon, Scale, Search, Star, Trash2, Users, X } from "lucide-react";
import { type SyntheticEvent, useEffect, useState } from "react";
import { AnalysisTeamTable, type TeamComment } from "./AnalysisTeamTable";
import { TeamLookupInput } from "./TeamLookupInput";
import type { Report } from "./analysis-table";
import { API_URL, api } from "./api";

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

export function Analysis({
  initialReportId,
  canManageReports,
}: {
  initialReportId?: string | null;
  canManageReports: boolean;
}) {
  const questions = useQuestions();
  const [team, setTeam] = useState("");
  const [searched, setSearched] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [teamB, setTeamB] = useState("");
  const [searchedB, setSearchedB] = useState("");
  const [reportsB, setReportsB] = useState<Report[]>([]);
  const [teamMatches, setTeamMatches] = useState<TeamMatch[]>([]);
  const [teamComments, setTeamComments] = useState<TeamComment[]>([]);
  const [competition, setCompetition] = useState("all");
  const [reportKind, setReportKind] = useState<"all" | "scouting" | "pit">("scouting");
  const [eventNames, setEventNames] = useState<Record<string, string>>({});
  const [currentEventKey, setCurrentEventKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [blankPathIds, setBlankPathIds] = useState<Set<string>>(() => new Set());
  const [tab, setTab] = useState<"stats" | "matches" | "auto" | "compare">("stats");
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
        eventNames: Record<string, string>;
        currentEventKey?: string | null;
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
      setSearched(teamFilter);
      setSearchedB(tab === "compare" ? teamBFilter : "");
      setTeamComments(result.teamComments);
      setTeamMatches(result.teamMatches);
      setEventNames(result.eventNames ?? {});
      setCurrentEventKey(result.currentEventKey || null);
      // The page opens on the event being scouted now, or on a report someone linked to.
      const linkedReport = result.reports.find((report) => report.id === initialReportId);
      if (!loaded && linkedReport) {
        setReportKind(linkedReport.formKind || "scouting");
        setCompetition(linkedReport.eventKey || "Unassigned");
      } else if (!loaded) {
        setCompetition(result.currentEventKey || "all");
      }
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
      !(await questions.confirm(
        `Permanently delete this report for team ${report.teamName}? This cannot be undone.`,
      ))
    )
      return;
    if (!(await questions.confirm("Confirm permanent deletion one more time."))) return;
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

  const eventLabel = (key?: string) => (key ? eventNames[key] || key : "Unassigned");
  // Stats shows match or pit scouting, each as its own table.
  const shownKind = tab === "stats" && reportKind === "all" ? "scouting" : reportKind;
  const matchesReportFilters = (report: Report) =>
    (shownKind === "all" || (report.formKind || "scouting") === shownKind) &&
    (competition === "all" || (report.eventKey || "Unassigned") === competition);
  const activeReports = reports.filter(
    (report) => !report.archivedAt && matchesReportFilters(report),
  );
  const activeReportsB = reportsB.filter(
    (report) => !report.archivedAt && matchesReportFilters(report),
  );
  const summaryA = numericSummary(activeReports);
  const summaryB = numericSummary(activeReportsB);
  const comparisonLabels = [...new Set([...summaryA.keys(), ...summaryB.keys()])];
  const competitions = [
    ...new Set([
      ...(currentEventKey ? [currentEventKey] : []),
      ...reports.map((report) => report.eventKey || "Unassigned"),
      ...reportsB.map((report) => report.eventKey || "Unassigned"),
      ...teamComments.map((comment) => comment.event_key || "Unassigned"),
    ]),
  ].sort(
    (left, right) => eventLabel(left).localeCompare(eventLabel(right)) || left.localeCompare(right),
  );
  const coveredMatches = new Set(
    activeReports.flatMap((report) =>
      report.matchKey || report.matchNumber ? [report.matchKey || report.matchNumber] : [],
    ),
  ).size;
  const teamCount = new Set(activeReports.map((report) => report.teamName)).size;
  const scoutCount = new Set(activeReports.map((report) => report.submittedByName)).size;
  const highlightedReports = activeReports.filter(
    (report) => report.starredFieldIds.length > 0,
  ).length;

  const autoFields = activeReports.flatMap((report) =>
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
      const eventOrder = eventLabel(left.event_key).localeCompare(eventLabel(right.event_key));
      return eventOrder || right.created_at - left.created_at;
    });
  const commentsByTeam = new Map<string, TeamComment[]>();
  for (const comment of visibleComments) {
    commentsByTeam.set(comment.team_name, [
      ...(commentsByTeam.get(comment.team_name) ?? []),
      comment,
    ]);
  }
  // Comments on a team with a row are in its row; the rest are listed under the table.
  const teamsWithRows = new Set(activeReports.map((report) => report.teamName));
  const commentsWithoutReports = [...commentsByTeam].filter(
    ([teamNumber]) => !teamsWithRows.has(teamNumber),
  );
  return (
    <SharedPage
      title={<>Analysis</>}
      width="wide"
      className="scouting-page-frame"
      contentClassName="page analysis-page"
      description=<span>
        {searched ? `Team ${searched}` : `${reports.length} scouting reports`}
      </span>
    >
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
        <Button variant="primary" type="submit">
          {loading ? "Loading…" : tab === "compare" ? "Compare" : team ? "Find team" : "Show all"}
        </Button>
        {(team || searched || teamB || searchedB) && (
          <Button
            variant="secondary"
            type="button"
            className="analysis-clear"
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
          </Button>
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
      {tab !== "matches" && (
        <div className="analysis-controls">
          {tab === "stats" ? (
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">Report type</legend>
              <Chip selected={shownKind === "scouting"} onClick={() => setReportKind("scouting")}>
                Match scouting
              </Chip>
              <Chip selected={shownKind === "pit"} onClick={() => setReportKind("pit")}>
                Pit scouting
              </Chip>
            </fieldset>
          ) : (
            <label className="competition-filter">
              Report type
              <select
                className={inputClass}
                value={reportKind}
                aria-label="Report type"
                onChange={(event) => setReportKind(event.target.value as typeof reportKind)}
              >
                <option value="scouting">Match scouting</option>
                <option value="pit">Pit scouting</option>
                <option value="all">All reports</option>
              </select>
            </label>
          )}
          {competitions.length > 0 && (
            <label className="competition-filter">
              Competition
              <select
                className={inputClass}
                value={competition}
                aria-label="Competition"
                onChange={(event) => setCompetition(event.target.value)}
              >
                <option value="all">All competitions</option>
                {competitions.map((eventKey) => (
                  <option value={eventKey} key={eventKey}>
                    {eventLabel(eventKey)}
                    {eventKey === currentEventKey ? " (now)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {tab === "stats" ? (
        <div className="analysis-results-stack">
          {loaded && activeReports.length > 0 && (
            <section className="analysis-overview" aria-label="Scouting summary">
              <div>
                <BarChart3 size={18} />
                <strong>{activeReports.length}</strong>
                <span>Reports</span>
              </div>
              <div>
                <Users size={18} />
                <strong>{teamCount}</strong>
                <span>Teams</span>
              </div>
              {shownKind === "scouting" && (
                <div>
                  <Scale size={18} />
                  <strong>{coveredMatches}</strong>
                  <span>Matches</span>
                </div>
              )}
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
            </section>
          )}
          {loaded && !activeReports.length && (
            <div className="forms-empty">
              {searched
                ? `No ${shownKind === "pit" ? "pit" : "match"} scouting reports for team ${searched}${competition === "all" ? "" : ` at ${eventLabel(competition)}`}.`
                : `No ${shownKind === "pit" ? "pit" : "match"} scouting reports${competition === "all" ? "" : ` at ${eventLabel(competition)}`} yet.`}
            </div>
          )}
          {activeReports.length > 0 && (
            <AnalysisTeamTable
              key={shownKind}
              kind={shownKind === "pit" ? "pit" : "scouting"}
              reports={activeReports}
              commentsByTeam={commentsByTeam}
              eventLabel={eventLabel}
              focusReportId={initialReportId}
              canManageReports={canManageReports}
              onToggleStar={(report) => toggleStar(report, "__report")}
              onDelete={permanentlyDeleteReport}
              onViewDrawing={({ url, teamName, label }) =>
                setSelectedPath({ url: `${API_URL}${url}`, teamName, label })
              }
            />
          )}
          {commentsWithoutReports.length > 0 && (
            <section className="team-comment-directory" aria-label="Comments on other teams">
              {commentsWithoutReports.map(([teamNumber, comments]) => (
                <article key={teamNumber}>
                  <h2>Team {teamNumber}</h2>
                  {comments.map((comment) => (
                    <div key={comment.id}>
                      <p>{comment.comment}</p>
                      <small>
                        {eventLabel(comment.event_key)} · {comment.created_by_name} ·{" "}
                        {new Date(comment.created_at).toLocaleString()}
                      </small>
                    </div>
                  ))}
                </article>
              ))}
            </section>
          )}
        </div>
      ) : tab === "matches" ? (
        <div className="match-history">
          {teamMatches.map((match) => (
            <article
              key={match.key}
              className={match.relationToTeam !== "none" ? "team-match" : ""}
            >
              <header>
                <strong>{match.label}</strong>
                {match.relationToTeam !== "none" && (
                  <span>
                    Played {match.relationToTeam} Team {pageTeamNumber}
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
                      {eventLabel(report.eventKey)} · {report.formName} ·{" "}
                      {new Date(report.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {canManageReports && (
                    <Button
                      variant="danger"
                      type="button"
                      className="delete-report-button"
                      onClick={() => permanentlyDeleteReport(report)}
                      aria-label={`Permanently delete report for ${report.teamName}`}
                      title="Remove bad data"
                    >
                      <Trash2 size={17} />
                    </Button>
                  )}
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
                <span>{label}</span>
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
    </SharedPage>
  );
}
