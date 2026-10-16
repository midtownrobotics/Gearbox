import { ErrorBanner, Page, Stat, focusRing } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../shared/api";
import { type InstanceState, buildInstanceRows, processLoads } from "../../shared/derive";
import { processPath } from "../../shared/nav";
import { useShopData } from "../../shared/use-shop-data";

// Overview: the shop at a glance. Each tile is a figure from one of the other pages and opens it.

const tileClass = `block min-w-0 rounded-xl border border-secondary-200 bg-surface p-5 hover:border-secondary-400 ${focusRing}`;

/** How many released parts are waiting on Ingest; null until the worker has said. */
function useWaitingToIngest(): number | null {
  const [waiting, setWaiting] = useState<number | null>(null);
  useEffect(() => {
    api.admin.parts.pending
      .$get()
      .then(async (res) => {
        if (!res.ok) return;
        const { parts } = (await res.json()) as { parts: unknown[] };
        setWaiting(parts.length);
      })
      .catch(() => {});
  }, []);
  return waiting;
}

export function OverviewPage() {
  const { data, error } = useShopData();
  const waiting = useWaitingToIngest();

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
    <Page title="Overview">
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
