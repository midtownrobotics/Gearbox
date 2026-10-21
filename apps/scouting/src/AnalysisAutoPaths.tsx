import { Button } from "@g3/ui";
import { ChevronRight, Map as MapIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { type AutoPath, type AutoPathMatch, groupAutoPaths } from "./analysis-auto-paths";
import { type Report, matchLabel } from "./analysis-table";

type Props = {
  paths: AutoPath[];
  loaded: boolean;
  searched: string;
  eventLabel(key?: string): string;
  imageUrl(url: string): string;
  canManageReports: boolean;
  onDelete(report: Report): Promise<void>;
  onView(path: AutoPath): void;
  onImageLoad(path: AutoPath, image: HTMLImageElement): void;
};

export function AnalysisAutoPaths(props: Props) {
  const teams = groupAutoPaths(props.paths);
  return (
    <div className="space-y-2">
      {teams.map(({ team, matches }) => (
        <details
          key={team}
          className="group/team overflow-hidden rounded-lg border border-secondary-200 bg-surface"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold text-secondary-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              size={16}
              aria-hidden="true"
              className="shrink-0 transition-transform group-open/team:rotate-90"
            />
            <span className="min-w-0 flex-1 break-words">Team {team}</span>
            <span className="shrink-0 text-xs font-normal text-secondary-500">
              {matches.length} {matches.length === 1 ? "match" : "matches"}
            </span>
          </summary>
          <div className="divide-y divide-secondary-100 border-t border-secondary-200">
            {matches.map((match) => (
              <MatchPaths key={match.key} match={match} {...props} />
            ))}
          </div>
        </details>
      ))}
      {props.loaded && !teams.length && (
        <div className="forms-empty">
          No autonomous paths reported{props.searched ? ` for ${props.searched}` : ""}.
        </div>
      )}
    </div>
  );
}

function MatchPaths({ match, ...props }: Props & { match: AutoPathMatch }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="group/match" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-sm text-secondary-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={14}
          aria-hidden="true"
          className="shrink-0 transition-transform group-open/match:rotate-90"
        />
        <strong>{matchLabel(match.report)}</strong>
        <span className="text-xs text-secondary-500">
          {props.eventLabel(match.report.eventKey)}
        </span>
        <span className="ml-auto text-xs text-secondary-500">
          {match.paths.length} {match.paths.length === 1 ? "path" : "paths"}
        </span>
      </summary>
      {open && (
        <div className="auto-path-grid px-3 pb-3">
          {match.paths.map((path) => (
            <article key={`${path.report.id}-${path.field.id}`}>
              <button
                type="button"
                className="auto-path-image-link"
                aria-label={`Open full-size path for team ${path.report.teamName}, ${matchLabel(path.report)}`}
                title="Open full-size drawing"
                onClick={() => props.onView(path)}
              >
                <img
                  src={props.imageUrl(path.url)}
                  alt={`Team ${path.report.teamName} - ${matchLabel(path.report)} - ${path.field.label}`}
                  crossOrigin="use-credentials"
                  onLoad={(event) => props.onImageLoad(path, event.currentTarget)}
                />
              </button>
              <div>
                <MapIcon size={16} aria-hidden="true" />
                <strong>{path.field.label}</strong>
                <span>
                  {path.report.submittedByName} - {path.report.formName} -{" "}
                  {new Date(path.report.createdAt).toLocaleDateString()}
                </span>
              </div>
              {props.canManageReports && (
                <Button
                  variant="danger"
                  type="button"
                  className="delete-report-button"
                  onClick={() => props.onDelete(path.report)}
                  aria-label={`Permanently delete report for ${path.report.teamName}`}
                  title="Remove bad data"
                >
                  <Trash2 size={17} />
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
    </details>
  );
}
