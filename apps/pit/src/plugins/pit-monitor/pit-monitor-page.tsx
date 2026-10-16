import { Button, ProgressBar, useTeamNames } from "@g3/ui";
import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { useBatteryCache } from "../../shared/battery-cache-context";
import { ElapsedTime, STATE_TONES, voltageColor } from "../../shared/battery-display";
import { useFullscreen } from "../../shared/fullscreen-context";
import { fetchBatteries } from "../../shared/getters/batteries";
import { type MatchLog, fetchDownloaders, fetchMatchLogs } from "../../shared/getters/downloaders";
import { fetchAllIssues } from "../../shared/getters/issues";
import { fetchLists } from "../../shared/getters/lists";
import type {
  Battery,
  BatteryState,
  ChecklistIssueSummary,
  ChecklistList,
} from "../../shared/getters/types";
import { type PersonInThePit, untilLabel, useInThePit } from "../../shared/in-the-pit";

const REFRESH_MS = 15_000;

// ── External data types ────────────────────────────────────────────────────

type RankingRow = {
  rank: number | null;
  wins: number;
  losses: number;
  ties: number;
  rp: number;
  epa: number;
};

type NexusMatchTime = {
  estimatedQueueTime?: number | null;
  estimatedOnFieldTime?: number | null;
  estimatedStartTime?: number | null;
  actualQueueTime?: number | null;
  actualOnFieldTime?: number | null;
};

type NexusMatch = {
  label: string;
  status: "Queuing soon" | "Now queuing" | "On deck" | "On field";
  redTeams?: (string | null | undefined)[] | null;
  blueTeams?: (string | null | undefined)[] | null;
  times: NexusMatchTime;
};

type NexusData = {
  nowQueuing?: string | null;
  matches: NexusMatch[];
  isRealNexus?: boolean;
};

type ContextRankings = {
  top3: Array<{ rank: number; team: string }>;
  context: Array<{ rank: number; team: string }>;
};

type MonitorData = {
  teamNumber: string;
  nexus: NexusData | null;
  ranking: RankingRow | null;
  contextRankings?: ContextRankings | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCountdown(targetMs: number): string {
  const remaining = targetMs - Date.now();
  if (remaining <= 0) return "Now";
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatTime(ms?: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

function teamInMatch(m: NexusMatch, team: string): boolean {
  return (
    m.blueTeams?.some((t) => t === team) === true || m.redTeams?.some((t) => t === team) === true
  );
}

// ── Isolated timer components ──────────────────────────────────────────────

function Countdown({ targetMs }: { targetMs: number }) {
  const [text, setText] = useState(() => formatCountdown(targetMs));
  useEffect(() => {
    const interval = setInterval(() => setText(formatCountdown(targetMs)), 250);
    return () => clearInterval(interval);
  }, [targetMs]);
  return <>{text}</>;
}

// ── Sections ───────────────────────────────────────────────────────────────

function NexusSection({ nexus, teamNumber }: { nexus: NexusData; teamNumber: string }) {
  const onDeck = nexus.matches.find((m) => m.status === "On deck");
  const nowQueuing = nexus.matches.find((m) => m.status === "Now queuing");
  const queuingSoon = nexus.matches.find((m) => m.status === "Queuing soon");

  if (!onDeck && !nowQueuing && !queuingSoon) return null;

  return (
    <div className="grid grid-cols-3 gap-2">
      {onDeck && (
        <div
          className={`rounded-xl p-2.5 border ${teamInMatch(onDeck, teamNumber) ? "bg-red-100 border-red-300 ring-2 ring-red-400" : "bg-red-100 border-red-300"}`}
        >
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-red-600">
              On Deck {teamInMatch(onDeck, teamNumber) && "!"}
            </p>
            <p className="text-lg font-black text-secondary-900">{onDeck.label}</p>
            {onDeck.times.estimatedOnFieldTime && (
              <div>
                <p className="text-[10px] text-secondary-600">On field in</p>
                <p className="text-sm font-bold text-red-600 tabular-nums">
                  <Countdown targetMs={onDeck.times.estimatedOnFieldTime} />
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {nowQueuing && (
        <div
          className={`rounded-xl p-2.5 border ${teamInMatch(nowQueuing, teamNumber) ? "bg-amber-100 border-amber-300 ring-2 ring-amber-400" : "bg-amber-100 border-amber-300"}`}
        >
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-secondary-900">
              Now Queuing {teamInMatch(nowQueuing, teamNumber) && "!"}
            </p>
            <p className="text-lg font-black text-secondary-900">{nowQueuing.label}</p>
            {nowQueuing.times.estimatedOnFieldTime && (
              <div>
                <p className="text-[10px] text-secondary-600">On field in</p>
                <p className="text-sm font-bold text-secondary-900 tabular-nums">
                  <Countdown targetMs={nowQueuing.times.estimatedOnFieldTime} />
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {queuingSoon && (
        <div
          className={`rounded-xl p-2.5 border ${teamInMatch(queuingSoon, teamNumber) ? "bg-emerald-50 border-emerald-400 ring-2 ring-emerald-400" : "bg-emerald-50 border-emerald-300"}`}
        >
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
              Queuing Soon {teamInMatch(queuingSoon, teamNumber) && "!"}
            </p>
            <p className="text-lg font-black text-secondary-900">{queuingSoon.label}</p>
            {queuingSoon.times.estimatedQueueTime && (
              <div>
                <p className="text-[10px] text-secondary-600">Queue in</p>
                <p className="text-sm font-bold text-emerald-600 tabular-nums">
                  <Countdown targetMs={queuingSoon.times.estimatedQueueTime} />
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UpcomingMatchesSection({
  nexus,
  teamNumber,
}: {
  nexus: NexusData;
  teamNumber: string;
}) {
  const upcoming = nexus.matches.filter(
    (m) => teamInMatch(m, teamNumber) && m.status !== "On field",
  );

  if (upcoming.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">
        Upcoming Matches
      </h2>
      <div
        className="bg-surface border border-secondary-200 rounded-xl overflow-hidden flex flex-col"
        style={{ maxHeight: "400px" }}
      >
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface border-b border-secondary-200">
              <tr className="text-secondary-600 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-2 font-semibold">Match</th>
                <th className="text-left px-4 py-2 font-semibold">Queue</th>
                <th className="text-left px-4 py-2 font-semibold">Start</th>
                <th className="text-left px-4 py-2 font-semibold">Blue</th>
                <th className="text-left px-4 py-2 font-semibold">Red</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((m) => {
                const isOurMatch = teamInMatch(m, teamNumber);
                return (
                  <tr
                    key={m.label}
                    className={`border-b border-secondary-200/50 last:border-0 ${isOurMatch ? "bg-primary-50" : ""}`}
                  >
                    <td
                      className={`px-4 py-2.5 font-semibold ${isOurMatch ? "text-primary-700" : "text-secondary-900"}`}
                    >
                      {m.label}
                    </td>
                    <td
                      className={`px-4 py-2.5 tabular-nums ${isOurMatch ? "text-primary-600 font-semibold" : "text-secondary-600"}`}
                    >
                      {m.times.actualQueueTime
                        ? formatTime(m.times.actualQueueTime)
                        : m.times.estimatedQueueTime
                          ? formatTime(m.times.estimatedQueueTime)
                          : "—"}
                    </td>
                    <td
                      className={`px-4 py-2.5 tabular-nums ${isOurMatch ? "text-primary-600 font-semibold" : "text-secondary-600"}`}
                    >
                      {formatTime(m.times.estimatedStartTime)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          m.blueTeams?.includes(teamNumber)
                            ? "text-blue-600 font-bold bg-blue-100 px-2 py-1 rounded"
                            : "text-secondary-600"
                        }
                      >
                        {m.blueTeams?.filter(Boolean).join(", ")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          m.redTeams?.includes(teamNumber)
                            ? "text-red-600 font-bold bg-red-100 px-2 py-1 rounded"
                            : "text-secondary-600"
                        }
                      >
                        {m.redTeams?.filter(Boolean).join(", ")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RankingSection({
  ranking,
  contextRankings,
  teamNumber,
}: {
  ranking: RankingRow;
  contextRankings?: ContextRankings | null;
  teamNumber: string;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">Ranking</h2>
      <div className="bg-surface border border-secondary-200 rounded-xl p-5">
        <div className="flex gap-6 items-start">
          {/* Left: rank info */}
          <div className="flex gap-6 shrink-0">
            {ranking.rank !== null && (
              <p className="text-6xl font-black text-secondary-900 leading-none">
                <span className="text-2xl text-secondary-600 font-normal">#</span>
                {ranking.rank}
              </p>
            )}
            <div className="space-y-1 text-sm">
              <p className="text-secondary-700">
                <span className="text-emerald-600 font-bold">{ranking.wins}W</span>
                {" — "}
                <span className="text-red-600 font-bold">{ranking.losses}L</span>
                {ranking.ties > 0 && (
                  <>
                    {" — "}
                    <span className="text-secondary-600 font-bold">{ranking.ties}T</span>
                  </>
                )}
              </p>
              <p className="text-secondary-600">
                <span className="text-secondary-900 font-semibold">{ranking.rp}</span> RP
                {ranking.epa > 0 && (
                  <>
                    {" · "}
                    <span className="text-secondary-900 font-semibold">
                      {ranking.epa.toFixed(1)}
                    </span>{" "}
                    EPA
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Right: context table if available */}
          {contextRankings && (
            <div className="flex-1 pl-6 border-l border-secondary-300">
              <div className="grid grid-cols-2 gap-4">
                {/* Left: context (around us) */}
                <div className="space-y-2">
                  <p className="text-xs text-secondary-600 font-semibold">Around Us</p>
                  <div className="space-y-1">
                    {contextRankings.context.map((r) => (
                      <div
                        key={r.team}
                        className={`flex justify-between px-2.5 py-1.5 rounded text-sm ${
                          r.team === teamNumber
                            ? "bg-primary-100 text-primary-700 font-semibold"
                            : "text-secondary-700"
                        }`}
                      >
                        <span>#{r.rank}</span>
                        <span>{r.team}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: top 3 */}
                <div className="space-y-2">
                  <p className="text-xs text-secondary-600 font-semibold">Top 3</p>
                  <div className="space-y-1">
                    {contextRankings.top3.map((r) => (
                      <div
                        key={r.team}
                        className={`flex justify-between px-2.5 py-1.5 rounded text-sm ${
                          r.team === teamNumber
                            ? "bg-primary-100 text-primary-700 font-semibold"
                            : "text-secondary-700"
                        }`}
                      >
                        <span>#{r.rank}</span>
                        <span>{r.team}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One of the Monitor's three batteries, in its state's color. */
function BatteryTile({
  label,
  battery,
  state,
  none,
}: { label: string; battery: Battery | undefined; state: BatteryState; none: string }) {
  return (
    <div className={`rounded-xl border p-3 ${STATE_TONES[state]}`}>
      <p className="mb-2 text-xs font-bold uppercase tracking-widest">{label}</p>
      {battery ? (
        <div className="space-y-1">
          <p className="text-xl font-black text-secondary-900">{battery.name}</p>
          <p className="text-xs tabular-nums text-secondary-600">
            <ElapsedTime sinceMs={battery.stateSince} />
          </p>
          {state !== "Charging" && battery.voltage != null && (
            <p
              className={`font-mono text-lg font-bold tabular-nums ${voltageColor(battery.voltage)}`}
            >
              {battery.voltage.toFixed(2)}V
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-secondary-600">{none}</p>
      )}
    </div>
  );
}

function BatteriesSection({ batteries }: { batteries: Battery[] }) {
  const inRobot = batteries.find((b) => b.state === "In Robot");
  const nextUp = batteries.find((b) => b.state === "Next Up");
  const longestCharging = batteries
    .filter((b) => b.state === "Charging")
    .sort((a, b) => a.stateSince - b.stateSince)[0];

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">Batteries</h2>
      <div className="bg-surface border border-secondary-200 rounded-xl p-5">
        <div className="grid grid-cols-3 gap-3">
          <BatteryTile label="In Robot" battery={inRobot} state="In Robot" none="No battery" />
          <BatteryTile label="Next Up" battery={nextUp} state="Next Up" none="None" />
          <BatteryTile label="Charging" battery={longestCharging} state="Charging" none="None" />
        </div>
      </div>
    </div>
  );
}

/** Who has a Pit role on the team's Schedule now, and until when. */
function InThePitSection({ people }: { people: PersonInThePit[] }) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">
        In the pit now
      </h2>
      <div className="bg-surface border border-secondary-200 rounded-xl p-5">
        {people.length === 0 ? (
          <p className="text-secondary-500">No one has a Pit role on the schedule right now.</p>
        ) : (
          <ul className="divide-y divide-secondary-200">
            {people.map((person) => (
              <li key={person.userId} className="flex items-baseline justify-between gap-3 py-2">
                <span className="font-semibold text-secondary-900">
                  {person.displayName ?? "Former member"}{" "}
                  <span className="font-normal text-secondary-500">{person.roleName}</span>
                </span>
                <span className="text-sm text-secondary-500">until {untilLabel(person.until)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The team's newest match logs from its log downloaders. */
function RecentLogsSection({ logs }: { logs: MatchLog[] }) {
  const when = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">
        Recent Logs
      </h2>
      <div className="bg-surface border border-secondary-200 rounded-xl p-5">
        {logs.length === 0 ? (
          <p className="text-secondary-500">No match logs yet.</p>
        ) : (
          <ul className="divide-y divide-secondary-200">
            {logs.map((log) => (
              <li key={log.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="font-semibold text-secondary-900">
                  {log.name} <span className="font-normal text-secondary-500">{log.event}</span>
                </span>
                <span className="text-sm text-secondary-500">
                  {log.uploadedAt ? when.format(log.uploadedAt) : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ChecklistSection({
  lists,
  issues,
}: {
  lists: ChecklistList[];
  issues: ChecklistIssueSummary[];
}) {
  const totalItems = lists.reduce((s, l) => s + l.itemCount, 0);
  const totalChecked = lists.reduce((s, l) => s + l.checkedCount, 0);
  const globalPct = totalItems > 0 ? Math.round((totalChecked / totalItems) * 100) : 0;
  const allDone = totalItems > 0 && totalChecked === totalItems;

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">
          Checklist Progress
        </h2>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span
              className={`text-sm font-semibold ${allDone ? "text-emerald-600" : "text-secondary-700"}`}
            >
              {allDone ? "All done!" : `${totalChecked} / ${totalItems} complete`}
            </span>
            <span
              className={`text-lg font-black tabular-nums ${allDone ? "text-emerald-600" : "text-secondary-900"}`}
            >
              {globalPct}%
            </span>
          </div>
          <ProgressBar percent={globalPct} done={allDone} className="!h-3" />
        </div>
        <div className="space-y-2">
          {lists.map((list) => {
            const pct =
              list.itemCount > 0 ? Math.round((list.checkedCount / list.itemCount) * 100) : 0;
            const done = list.itemCount > 0 && list.checkedCount === list.itemCount;
            return (
              <div key={list.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-secondary-600 truncate">{list.name}</span>
                  <span
                    className={`text-sm font-semibold tabular-nums shrink-0 ml-3 ${done ? "text-emerald-600" : "text-secondary-700"}`}
                  >
                    {list.checkedCount}/{list.itemCount}
                  </span>
                </div>
                <ProgressBar percent={pct} done={done} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Issues */}
      <div className="space-y-2 pt-2 border-t border-secondary-200">
        <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">
          Open Issues{" "}
          {issues.length > 0 && (
            <span className="text-secondary-900 normal-case">{issues.length}</span>
          )}
        </h2>
        {issues.length === 0 ? (
          <p className="text-emerald-600 text-sm font-semibold">No open issues ✓</p>
        ) : (
          <div className="space-y-2">
            {issues.map((issue) => (
              <div
                key={issue.id}
                className="bg-amber-100 border border-amber-300 rounded-xl px-4 py-3"
              >
                <p className="text-sm text-secondary-900 leading-snug">{issue.text}</p>
                <p className="text-xs text-secondary-600 mt-0.5">
                  {issue.listName} · {issue.itemName}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────

export function PitMonitorPage() {
  const names = useTeamNames();
  const { isFullscreen, setFullscreen } = useFullscreen();
  const { setBatteries: setCachedBatteries } = useBatteryCache();
  const [batteries, setBatteries] = useState<Battery[]>([]);
  const [lists, setLists] = useState<ChecklistList[]>([]);
  const [issues, setIssues] = useState<ChecklistIssueSummary[]>([]);
  const [monitor, setMonitor] = useState<MonitorData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  // The team's stream link (Admin), shown when it has one.
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  // The newest match logs, while the team has a paired log downloader; null hides the box.
  const [recentLogs, setRecentLogs] = useState<MatchLog[] | null>(null);
  // Who's in the pit on the team's Schedule; hidden while Schedule is off or hasn't answered.
  const inThePit = useInThePit();

  const handleFullscreen = async () => {
    if (!isFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
        setFullscreen(true);
      } catch (err) {
        console.error("Fullscreen request failed:", err);
      }
    } else {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      setFullscreen(false);
    }
  };

  async function loadAll() {
    const [b, l, i, m, logs] = await Promise.all([
      fetchBatteries().catch(() => [] as Battery[]),
      fetchLists().catch(() => [] as ChecklistList[]),
      fetchAllIssues().catch(() => [] as ChecklistIssueSummary[]),
      api.monitor.data
        .$get()
        .then((r) => (r.ok ? (r.json() as Promise<MonitorData>) : null))
        .catch(() => null),
      fetchDownloaders()
        .then(async ({ downloaders }) =>
          downloaders.length ? (await fetchMatchLogs()).logs.slice(0, 3) : null,
        )
        .catch(() => undefined),
    ]);
    setBatteries(b);
    setCachedBatteries(b);
    setLists(l);
    setIssues(i);
    setMonitor(m);
    // Kept as it was when it couldn't be asked.
    if (logs !== undefined) setRecentLogs(logs);
    setLastUpdated(new Date());
    setLoading(false);
  }

  async function loadSettings() {
    const response = await api.monitor.settings.$get();
    if (!response.ok) return;
    const settings = (await response.json()) as { iframeUrl?: string };
    setIframeUrl(settings.iframeUrl || null);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadAll is stable
  useEffect(() => {
    void loadAll();
    void loadSettings().catch(() => {});
    let requestInFlight = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || requestInFlight) return;
      requestInFlight = true;
      try {
        await loadAll();
      } finally {
        requestInFlight = false;
      }
    };
    const interval = setInterval(() => void refresh(), REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  if (loading) {
    return (
      <main className="flex-1 bg-page flex items-center justify-center">
        <p className="text-secondary-600 text-lg">Loading…</p>
      </main>
    );
  }

  const teamNumber = monitor?.teamNumber ?? "";
  const hasNexus = !!monitor?.nexus;
  const nexus = monitor?.nexus;

  return (
    <main className="flex-1 bg-page text-secondary-900">
      <div className="px-6 py-5 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-secondary-200 pb-4">
          <h1 className="text-2xl font-black tracking-tight">{names.appTitle("Pit")} Monitor</h1>
          <div className="flex items-center gap-4">
            {lastUpdated && (
              <p className="text-xs text-secondary-600">
                Updated {lastUpdated.toLocaleTimeString()}
              </p>
            )}
            <Button variant="secondary" size="sm" onClick={handleFullscreen}>
              {isFullscreen ? "Exit full screen" : "Full screen"}
            </Button>
          </div>
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Nexus status (only with real Nexus data) + ranking + upcoming matches. In the
              column, so the right one starts at the top instead of under it. */}
          <div className="space-y-5">
            {nexus?.isRealNexus && <NexusSection nexus={nexus} teamNumber={teamNumber} />}
            {monitor?.ranking && (
              <RankingSection
                ranking={monitor.ranking}
                contextRankings={monitor.contextRankings}
                teamNumber={teamNumber}
              />
            )}
            {hasNexus && nexus && <UpcomingMatchesSection nexus={nexus} teamNumber={teamNumber} />}
          </div>

          {/* Right: the stream (when set) + recent logs + batteries + checklist + issues */}
          <div className="space-y-5">
            {iframeUrl && (
              <div className="space-y-2">
                <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">
                  Monitor Feed
                </h2>
                <div className="bg-surface border border-secondary-200 rounded-xl overflow-hidden">
                  <iframe
                    src={iframeUrl}
                    title="Custom monitor feed"
                    className="w-full"
                    style={{ height: "500px" }}
                    frameBorder="0"
                    allowFullScreen
                  />
                </div>
              </div>
            )}
            {inThePit && <InThePitSection people={inThePit} />}
            {recentLogs && <RecentLogsSection logs={recentLogs} />}
            <BatteriesSection batteries={batteries} />
            <ChecklistSection lists={lists} issues={issues} />
          </div>
        </div>
      </div>
    </main>
  );
}
