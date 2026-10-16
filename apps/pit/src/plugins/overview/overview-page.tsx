import { Page, ProgressBar, Stat, focusRing } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ElapsedTime, voltageColor } from "../../shared/battery-display";
import { fetchArchives, fetchNextMatch } from "../../shared/getters/archives";
import { fetchBatteries } from "../../shared/getters/batteries";
import { fetchAllIssues } from "../../shared/getters/issues";
import { fetchLists } from "../../shared/getters/lists";
import {
  ARCHIVE_TYPE_LABELS,
  type Battery,
  type ChecklistArchive,
  type ChecklistIssueSummary,
  type ChecklistList,
} from "../../shared/getters/types";

// Overview: the pit at a glance. Each tile is a figure from one of the other pages and opens it.

const POLL_INTERVAL_MS = 10_000;
/** The next match is asked of The Blue Alliance or Nexus, so it's asked for less often. */
const MATCH_INTERVAL_MS = 120_000;

const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const tileClass = `block min-w-0 rounded-xl border border-secondary-200 bg-surface p-5 hover:border-secondary-400 ${focusRing}`;

/** The newest archive; null when there is none, undefined while nobody has said. */
type LastArchive = ChecklistArchive | null | undefined;

/**
 * What the tiles show. Each part is asked for on its own and keeps what it last had when it
 * can't be asked again, so with no connection the page shows what it last knew and never an
 * error. A part nobody has answered yet is null (`lastArchive`: undefined).
 */
function useFigures() {
  const [lists, setLists] = useState<ChecklistList[] | null>(null);
  const [issues, setIssues] = useState<ChecklistIssueSummary[] | null>(null);
  const [batteries, setBatteries] = useState<Battery[] | null>(null);
  const [lastArchive, setLastArchive] = useState<LastArchive>(undefined);
  const [nextMatch, setNextMatch] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let current = true;
    let requestInFlight = false;
    const keep = () => {};
    const load = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      await Promise.all([
        fetchLists().then((data) => current && setLists(data), keep),
        fetchAllIssues().then((data) => current && setIssues(data), keep),
        fetchBatteries().then((data) => current && setBatteries(data), keep),
        fetchArchives().then((page) => current && setLastArchive(page.archives[0] ?? null), keep),
      ]);
      requestInFlight = false;
      if (current) setLoaded(true);
    };
    const loadMatch = () => {
      fetchNextMatch().then((match) => current && setNextMatch(match), keep);
    };
    const visible = () => document.visibilityState === "visible";
    const refresh = () => {
      if (visible()) void load();
    };

    void load();
    loadMatch();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    const matchInterval = setInterval(() => {
      if (visible()) loadMatch();
    }, MATCH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      current = false;
      clearInterval(interval);
      clearInterval(matchInterval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return { lists, issues, batteries, lastArchive, nextMatch, loaded };
}

/** What an archive was for, in a few words: its details, else its type. */
function archiveLabel(archive: ChecklistArchive): string {
  return archive.details.trim() || ARCHIVE_TYPE_LABELS[archive.type];
}

function ChecklistsTile({
  lists,
  archived,
  unknown,
}: { lists: ChecklistList[] | null; archived: boolean; unknown: string }) {
  const total = lists?.reduce((sum, list) => sum + list.itemCount, 0) ?? 0;
  const checked = lists?.reduce((sum, list) => sum + list.checkedCount, 0) ?? 0;
  const done = total > 0 && checked === total;
  return (
    <Link to="/checklists" className={tileClass}>
      <Stat
        label="Checklists"
        value={!lists ? unknown : total === 0 ? "None yet" : `${checked} of ${total}`}
      />
      {total > 0 && (
        <ProgressBar percent={(checked / total) * 100} done={done} className="mt-3 !h-2" />
      )}
      {lists && (
        <p className="mt-2 text-xs text-secondary-500">
          {total === 0
            ? "Make one on Edit Checklists."
            : done
              ? "all done"
              : archived
                ? "checked since the last archive"
                : "items checked"}
        </p>
      )}
    </Link>
  );
}

function IssuesTile({
  issues,
  lastArchive,
  unknown,
}: { issues: ChecklistIssueSummary[] | null; lastArchive: LastArchive; unknown: string }) {
  let hint: string | undefined;
  if (issues && issues.length === 0) hint = "nothing reported";
  else if (issues && lastArchive) {
    // Both are in seconds.
    const fresh = issues.filter((issue) => issue.createdAt > lastArchive.archivedAt).length;
    const since = lastArchive.details.trim() || "the last archive";
    hint = `${fresh === 0 ? "none" : fresh} new since ${since}`;
  }
  return (
    <Link to="/checklists#issues" className={tileClass}>
      <Stat label="Open issues" value={issues ? issues.length : unknown} hint={hint} />
    </Link>
  );
}

/** The battery to put in next, with the one in the robot under it. */
function BatteriesTile({ batteries, unknown }: { batteries: Battery[] | null; unknown: string }) {
  const nextUp = batteries?.find((battery) => battery.state === "Next Up");
  const inRobot = batteries?.find((battery) => battery.state === "In Robot");
  return (
    <Link to="/batteries" className={tileClass}>
      {!batteries || batteries.length === 0 ? (
        <Stat
          label="Batteries"
          value={batteries ? "None yet" : unknown}
          hint={batteries ? "Add one on Batteries." : undefined}
        />
      ) : (
        <>
          <p className="text-xs font-bold uppercase tracking-widest text-secondary-400">
            Batteries
          </p>
          <dl className="mt-1 grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-1">
            <dt className="text-xs font-medium text-secondary-500">Next Up</dt>
            <dd
              className={`min-w-0 truncate text-2xl font-semibold ${nextUp ? "text-secondary-900" : "text-secondary-400"}`}
            >
              {nextUp?.name ?? "None"}
            </dd>
            <dd className="font-mono text-sm tabular-nums">
              {nextUp?.voltage != null && (
                <span className={voltageColor(nextUp.voltage)}>{nextUp.voltage.toFixed(2)}V</span>
              )}
            </dd>
            <dt className="text-xs font-medium text-secondary-500">In Robot</dt>
            <dd
              className={`min-w-0 truncate text-sm font-medium ${inRobot ? "text-secondary-900" : "text-secondary-400"}`}
            >
              {inRobot?.name ?? "None"}
            </dd>
            <dd className="text-xs tabular-nums text-secondary-500">
              {inRobot && <ElapsedTime sinceMs={inRobot.stateSince} />}
            </dd>
          </dl>
        </>
      )}
    </Link>
  );
}

/** At an event, the team's next match; anywhere else, the newest archive. */
function MatchTile({
  nextMatch,
  lastArchive,
  unknown,
}: { nextMatch: string; lastArchive: LastArchive; unknown: string }) {
  if (nextMatch) {
    return (
      <Link to="/monitor" className={tileClass}>
        <Stat
          label="Next match"
          value={nextMatch}
          hint={
            lastArchive
              ? `last archived: ${archiveLabel(lastArchive)}`
              : lastArchive === null
                ? "nothing archived yet"
                : undefined
          }
        />
      </Link>
    );
  }
  return (
    <Link to="/archives" className={tileClass}>
      <Stat
        label="Last archive"
        value={
          lastArchive ? (
            <span className="line-clamp-2 break-words">{archiveLabel(lastArchive)}</span>
          ) : lastArchive === null ? (
            "None yet"
          ) : (
            unknown
          )
        }
        hint={
          lastArchive
            ? [whenFormat.format(lastArchive.archivedAt * 1000), lastArchive.event]
                .filter(Boolean)
                .join(" · ")
            : lastArchive === null
              ? "Archive and reset on Checklists saves one."
              : undefined
        }
      />
    </Link>
  );
}

export function OverviewPage() {
  const { lists, issues, batteries, lastArchive, nextMatch, loaded } = useFigures();
  // A figure nobody has answered: still being asked for, or it couldn't be.
  const unknown = loaded ? "—" : "…";

  return (
    <Page title="Overview" width="narrow">
      <div className="grid gap-4 sm:grid-cols-2">
        <ChecklistsTile lists={lists} archived={!!lastArchive} unknown={unknown} />
        <IssuesTile issues={issues} lastArchive={lastArchive} unknown={unknown} />
        <BatteriesTile batteries={batteries} unknown={unknown} />
        <MatchTile nextMatch={nextMatch} lastArchive={lastArchive} unknown={unknown} />
      </div>
    </Page>
  );
}
