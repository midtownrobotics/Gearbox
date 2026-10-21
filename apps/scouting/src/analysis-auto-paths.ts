import { type Report, chronological } from "./analysis-table";

export type AutoPath = { report: Report; field: Report["fields"][number]; url: string };
export type AutoPathMatch = { key: string; report: Report; paths: AutoPath[] };
export type AutoPathTeam = { team: string; matches: AutoPathMatch[] };

/** Team numbers sort naturally; matches use the same event/qual/playoff order as Stats. */
export function groupAutoPaths(paths: AutoPath[]): AutoPathTeam[] {
  const teams = new Map<string, AutoPath[]>();
  for (const path of paths)
    teams.set(path.report.teamName, [...(teams.get(path.report.teamName) ?? []), path]);
  return [...teams]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([team, entries]) => {
      const reports = new Map(entries.map(({ report }) => [report.id, report]));
      const byReport = new Map<string, AutoPath[]>();
      for (const path of entries)
        byReport.set(path.report.id, [...(byReport.get(path.report.id) ?? []), path]);
      const matches = new Map<string, AutoPathMatch>();
      for (const report of chronological([...reports.values()])) {
        const key = JSON.stringify([
          report.eventKey ?? "",
          report.matchKey ||
            (report.matchNumber ? `qm${report.matchNumber}` : `report:${report.id}`),
        ]);
        const match = matches.get(key) ?? { key, report, paths: [] };
        match.paths.push(...(byReport.get(report.id) ?? []));
        matches.set(key, match);
      }
      return { team, matches: [...matches.values()] };
    });
}
