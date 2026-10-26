import { ErrorBanner, Page, Stat, focusRing } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../shared/api";
import { type InstanceState, buildInstanceRows, processLoads } from "../../shared/derive";
import { processPath } from "../../shared/nav";
import { ProjectFilter, useDataInProject, useProjectFilter } from "../../shared/projects";
import { useShopData } from "../../shared/use-shop-data";

// Overview: the shop at a glance. Each tile is a figure from one of the other pages and opens it.

const tileClass = `block min-w-0 rounded-xl border border-secondary-200 bg-surface p-5 hover:border-secondary-400 ${focusRing}`;

type Pending = {
  parts: { releaseId: number | null }[];
  releases: { id: number; projectId: number | null }[];
};

/**
 * How many released parts are waiting on Ingest in the project (all of them for null, and those
 * whose project isn't known in any); null until the worker has said.
 */
function useWaitingToIngest(projectId: number | null): number | null {
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    api.admin.parts.pending
      .$get()
      .then(async (res) => {
        if (res.ok) setPending((await res.json()) as Pending);
      })
      .catch(() => {});
  }, []);
  if (!pending) return null;
  const projectOf = new Map(pending.releases.map((r) => [r.id, r.projectId]));
  return pending.parts.filter((p) => {
    const project = p.releaseId === null ? null : (projectOf.get(p.releaseId) ?? null);
    return projectId === null || project === null || project === projectId;
  }).length;
}

export function OverviewPage() {
  const { data: allData, error } = useShopData();
  const projectFilter = useProjectFilter();
  const data = useDataInProject(allData, projectFilter.projectId);
  const waiting = useWaitingToIngest(projectFilter.projectId);

  const rows = data ? buildInstanceRows(data) : null;
  const count = (state: InstanceState) =>
    rows ? rows.filter((row) => row.state === state).length : "—";

  // The machine with the most parts at it, for the tile that opens the shop floor.
  const busiest =
    data && rows
      ? processLoads(rows, data.processes)
          .filter((load) => load.todo + load.doing > 0)
          .sort((a, b) => b.todo + b.doing - (a.todo + a.doing))[0]
      : undefined;

  return (
    <Page title="Overview" actions={<ProjectFilter filter={projectFilter} />}>
      {error && <ErrorBanner message={error} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/board" className={tileClass}>
          <Stat label="In progress" value={count("doing")} hint="parts being worked on" />
        </Link>
        <Link to={busiest ? processPath(busiest.process.id) : "/board"} className={tileClass}>
          <Stat
            label="Ready to start"
            value={count("todo")}
            hint={busiest ? `busiest: ${busiest.process.name}` : "parts waiting at a machine"}
          />
        </Link>
        <Link to="/parts" className={tileClass}>
          <Stat label="Complete" value={count("complete")} hint="parts finished" />
        </Link>
        <Link to="/ingest" className={tileClass}>
          <Stat
            label="To ingest"
            value={waiting ?? "—"}
            hint={waiting === 0 ? "nothing waiting" : "released parts waiting"}
          />
        </Link>
      </div>
    </Page>
  );
}
