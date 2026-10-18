import type { ScoutingField } from "./ScoutingForms";

export type Report = {
  id: string;
  teamName: string;
  formName: string;
  formKind: "scouting" | "pit";
  fields: ScoutingField[];
  answers: Record<string, unknown>;
  drawings: Record<string, string>;
  submittedByName: string;
  createdAt: number;
  eventKey?: string;
  matchKey?: string;
  matchNumber?: number;
  /** Sent after its match moved on, from a draft kept on the scout's device. */
  late?: boolean;
  starredFieldIds: string[];
  archivedAt?: number | null;
  archiveReason?: string;
};

/** One question of the forms the reports were filled in on, as a column of the table. */
export type Column = Pick<ScoutingField, "id" | "label" | "type" | "options">;

/** What a team's reports say to one question, for its row. */
export type Summary =
  | { kind: "number"; average: number; count: number }
  /** The answer given most, `times` of the `count` reports that answered. */
  | { kind: "choice"; answer: string; times: number; count: number; rank: number }
  | { kind: "none" };

export type SortKey = "team" | "reports" | `field:${string}`;
export type Sort = { key: SortKey; dir: "asc" | "desc" };

export const isNumeric = (column: Column) => column.type === "counter" || column.type === "slider";
export const isChoice = (column: Column) => column.type === "mcq" || column.type === "multiSelect";
export const isText = (column: Column) => column.type === "shortText" || column.type === "longText";

/**
 * The questions of the reports' forms, in the order of the newest report's form, then any only
 * older reports have (a question since removed, or another form's).
 */
export function columnsOf(reports: Report[]): Column[] {
  const columns = new Map<string, Column>();
  for (const report of [...reports].sort((left, right) => right.createdAt - left.createdAt)) {
    for (const { id, label, type, options } of report.fields) {
      if (!columns.has(id)) columns.set(id, { id, label, type, options: options ?? [] });
    }
  }
  return [...columns.values()];
}

/** Where an answer comes in the question's own list of options; unlisted ones after them. */
const rankOf = (column: Column, answer: string) => {
  const index = column.options.indexOf(answer);
  return index === -1 ? column.options.length : index;
};

/** A team's reports on one question: the average of a number, the answer given most of a choice. */
export function summarize(column: Column, reports: Report[]): Summary {
  if (isNumeric(column)) {
    const values = reports
      .map((report) => report.answers[column.id])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (!values.length) return { kind: "none" };
    const total = values.reduce((sum, value) => sum + value, 0);
    return { kind: "number", average: total / values.length, count: values.length };
  }
  if (!isChoice(column)) return { kind: "none" };
  const tally = new Map<string, number>();
  let count = 0;
  for (const report of reports) {
    const value = report.answers[column.id];
    const picked =
      column.type === "multiSelect"
        ? Array.isArray(value)
          ? value.map(String)
          : null
        : typeof value === "string" && value
          ? [value]
          : null;
    if (!picked) continue;
    count++;
    for (const answer of new Set(picked)) tally.set(answer, (tally.get(answer) ?? 0) + 1);
  }
  const [best] = [...tally].sort(
    ([left, leftTimes], [right, rightTimes]) =>
      rightTimes - leftTimes ||
      rankOf(column, left) - rankOf(column, right) ||
      left.localeCompare(right),
  );
  if (!best) return { kind: "none" };
  return { kind: "choice", answer: best[0], times: best[1], count, rank: rankOf(column, best[0]) };
}

/** One report's answer as text: a list joined with commas, nothing as an empty string. */
export function answerText(value: unknown) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

const PLAYOFF_LEVELS: Record<string, number> = { ef: 1, qf: 2, sf: 3, f: 4 };

/** A match key's level, set and number: `2026abc_qm12`, `2026abc_sf3m1`, `2026abc_f1m2`. */
function matchParts(report: Report) {
  const found = report.matchKey?.match(/_(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/);
  if (found) {
    const [, level, first, second] = found;
    return level === "qm"
      ? { level, set: 0, number: Number(first) }
      : { level, set: Number(first), number: Number(second ?? 1) };
  }
  if (report.matchNumber) return { level: "qm", set: 0, number: report.matchNumber };
  return null;
}

/** The match a report is about, as a short label: "Qual 12", "Playoff 3", "Final 2". */
export function matchLabel(report: Report) {
  const parts = matchParts(report);
  if (!parts) return "No match";
  if (parts.level === "qm") return `Qual ${parts.number}`;
  if (parts.level === "f") return `Final ${parts.number}`;
  if (parts.level === "sf" && parts.number === 1) return `Playoff ${parts.set}`;
  return `Playoff ${parts.set}-${parts.number}`;
}

const matchOrder = (report: Report) => {
  const parts = matchParts(report);
  if (!parts) return Number.MAX_SAFE_INTEGER;
  return (PLAYOFF_LEVELS[parts.level] ?? 0) * 1e6 + parts.set * 1e3 + parts.number;
};

/** Reports in the order they happened: by event, then match, then when they were sent. */
export function chronological(reports: Report[]) {
  const eventStart = new Map<string, number>();
  for (const report of reports) {
    const key = report.eventKey ?? "";
    eventStart.set(key, Math.min(eventStart.get(key) ?? report.createdAt, report.createdAt));
  }
  const startOf = (report: Report) => eventStart.get(report.eventKey ?? "") ?? 0;
  return [...reports].sort(
    (left, right) =>
      startOf(left) - startOf(right) ||
      matchOrder(left) - matchOrder(right) ||
      left.createdAt - right.createdAt,
  );
}

export type TeamRow = {
  team: string;
  /** Oldest first. */
  reports: Report[];
  /** By column id: the averages and most-given answers (match scouting) or the newest report's
   * answers (pit scouting). */
  summaries: Map<string, Summary>;
};

/** One row per team, each with its reports and what they say to every column. */
export function teamRows(reports: Report[], columns: Column[], kind: "scouting" | "pit") {
  const byTeam = new Map<string, Report[]>();
  for (const report of reports) {
    byTeam.set(report.teamName, [...(byTeam.get(report.teamName) ?? []), report]);
  }
  return [...byTeam].map(([team, teamReports]): TeamRow => {
    const ordered = chronological(teamReports);
    // A team's pit row is its newest pit report: one answer each, not a summary.
    const summarized = kind === "pit" ? ordered.slice(-1) : ordered;
    return {
      team,
      reports: ordered,
      summaries: new Map(columns.map((column) => [column.id, summarize(column, summarized)])),
    };
  });
}

const compareTeams = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true });

/** Compares two summaries of one column: numbers by size, choices by the option then how often. */
function compareSummaries(left: Summary, right: Summary) {
  if (left.kind === "number" && right.kind === "number") return left.average - right.average;
  if (left.kind === "choice" && right.kind === "choice") {
    return left.rank - right.rank || right.times / right.count - left.times / left.count;
  }
  return 0;
}

/** The rows in the chosen order; a team with no answer to the sorted column is always last. */
export function sortRows(rows: TeamRow[], sort: Sort) {
  const flip = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort.key === "team") return flip * compareTeams(left.team, right.team);
    if (sort.key === "reports") {
      return (
        flip * (left.reports.length - right.reports.length) || compareTeams(left.team, right.team)
      );
    }
    const id = sort.key.slice("field:".length);
    const leftSummary = left.summaries.get(id) ?? { kind: "none" };
    const rightSummary = right.summaries.get(id) ?? { kind: "none" };
    const missing = Number(leftSummary.kind === "none") - Number(rightSummary.kind === "none");
    return (
      missing ||
      flip * compareSummaries(leftSummary, rightSummary) ||
      compareTeams(left.team, right.team)
    );
  });
}

/** Whether a column can be sorted by: numbers and choices on match scouting, numbers and single
 * choices on pit scouting, where a row is one report's answers. */
export const sortable = (column: Column, kind: "scouting" | "pit") =>
  isNumeric(column) || column.type === "mcq" || (kind === "scouting" && isChoice(column));

/** The order a column starts in: the highest number first, a choice's options in their order. */
export const firstDir = (key: SortKey, columns: Column[]): Sort["dir"] => {
  if (key === "team") return "asc";
  if (key === "reports") return "desc";
  const column = columns.find((item) => `field:${item.id}` === key);
  return column && isNumeric(column) ? "desc" : "asc";
};
