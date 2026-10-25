import { Button, Chip, Page as SharedPage, inputClass, useQuestions } from "@g3/ui";
import { BarChart3, Scale, Search, Users, X } from "lucide-react";
import { type SyntheticEvent, useEffect, useState } from "react";
import { AnalysisAutoPaths } from "./AnalysisAutoPaths";
import { AnalysisTeamTable, type TeamComment } from "./AnalysisTeamTable";
import { MatchAnalysis, type TeamMatch } from "./MatchAnalysis";
import { TeamLookupInput } from "./TeamLookupInput";
import { matchLabel } from "./analysis-table";
import type { Report } from "./analysis-table";
import { API_URL, api } from "./api";

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
  const [teamMatchesError, setTeamMatchesError] = useState("");
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

  async function loadData(teamFilter = team, teamBFilter = teamB, eventFilter = competition) {
    setLoading(true);
    setLoadError("");
    try {
      const result = await api<{
        reports: Report[];
        teamMatches: TeamMatch[];
        teamMatchesError?: string;
        teamComments: TeamComment[];
        eventNames: Record<string, string>;
        currentEventKey?: string | null;
      }>(
        `/analysis?event=${encodeURIComponent(eventFilter)}&team=${encodeURIComponent(teamFilter)}${tab === "compare" ? `&teamB=${encodeURIComponent(teamBFilter)}` : ""}`,
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
      setTeamMatchesError(result.teamMatchesError ?? "");
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
  const comparisonLabels =
    searched && searchedB ? [...new Set([...summaryA.keys(), ...summaryB.keys()])] : [];
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
  const autoFields = activeReports.flatMap((report) =>
    report.fields
      .filter(
        (field) =>
          field.type === "fieldMap" &&
          (report.drawings[field.id] || report.answers[field.id] === "no-minimal-movement"),
      )
      .map((field) => ({ report, field, url: report.drawings[field.id] ?? "" })),
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
        {tab === "compare" && searched && searchedB
          ? `Team ${searched} and Team ${searchedB}`
          : searched
            ? `Team ${searched}`
            : `${reports.length} scouting reports`}
      </span>
    >
      <form className="analysis-search" onSubmit={search}>
        <Search size={19} />
        <TeamLookupInput
          required={tab === "compare"}
          value={team}
          onChange={setTeam}
          placeholder="Team number or name"
        />
        {tab === "compare" && (
          <>
            <Scale size={18} />
            <TeamLookupInput
              required
              value={teamB}
              onChange={setTeamB}
              placeholder="Another team number or name"
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
          onClick={() => {
            setTab("matches");
            void loadData(searched, "", competition);
          }}
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
      {
        <div className="analysis-controls">
          {tab === "matches" ? null : tab === "stats" ? (
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
                onChange={(event) => {
                  setCompetition(event.target.value);
                  if (tab === "matches") void loadData(searched, "", event.target.value);
                }}
              >
                <option value="all">
                  {tab === "matches" ? "Current event" : "All competitions"}
                </option>
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
      }
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
          {teamMatchesError && (
            <p role="alert" className="text-sm text-red-700">
              Could not load matches: {teamMatchesError}
            </p>
          )}
          {teamMatches.map((match) => (
            <MatchAnalysis
              key={match.key}
              match={match}
              eventLabel={eventLabel}
              canManageReports={canManageReports}
              onDelete={permanentlyDeleteReport}
              onView={({ report, field, url }) =>
                setSelectedPath({
                  url: API_URL + url,
                  teamName: report.teamName,
                  label: field.label,
                })
              }
            />
          ))}
          {loaded && !teamMatches.length && (
            <div className="forms-empty">
              No matches found for this event{searched ? " and team" : ""}.
            </div>
          )}
        </div>
      ) : tab === "auto" ? (
        <AnalysisAutoPaths
          paths={visibleAutoFields}
          loaded={loaded}
          searched={searched}
          eventLabel={eventLabel}
          imageUrl={(url) => API_URL + url}
          canManageReports={canManageReports}
          onDelete={permanentlyDeleteReport}
          onView={({ report, field, url }) =>
            setSelectedPath({
              url: API_URL + url,
              teamName: report.teamName,
              label: `${matchLabel(report)} - ${field.label}`,
            })
          }
          onImageLoad={({ report, field }, image) => {
            if (imageHasAutoPath(image)) return;
            setBlankPathIds((current) => new Set(current).add(`${report.id}-${field.id}`));
          }}
        />
      ) : (
        <div className="team-comparison">
          {searched && searchedB && (
            <div className="comparison-scoreboard">
              <div>
                <strong>Team {searched}</strong>
                <small>{activeReports.length} reports</small>
              </div>
              <Scale size={28} />
              <div>
                <strong>Team {searchedB}</strong>
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
                  <small className="comparison-team-name">Team {searched}</small>
                  {left?.toFixed(1) ?? "—"}
                </strong>
                <span>{label}</span>
                <strong className={winner === "right" ? "winner" : ""}>
                  <small className="comparison-team-name">Team {searchedB}</small>
                  {right?.toFixed(1) ?? "—"}
                </strong>
              </div>
            );
          })}
          {(!searched || !searchedB) && (
            <div className="forms-empty">Choose two teams and select Compare.</div>
          )}
          {searched && searchedB && !comparisonLabels.length && (
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
