import { appTitle } from "@g3/site-config";
import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { useBatteryCache } from "../../shared/battery-cache-context";
import { useFullscreen } from "../../shared/fullscreen-context";
import { fetchBatteries } from "../../shared/getters/batteries";
import { fetchAllIssues } from "../../shared/getters/issues";
import { fetchLists } from "../../shared/getters/lists";
import type { Battery, ChecklistIssueSummary, ChecklistList } from "../../shared/getters/types";

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

function formatElapsed(sinceMs: number): string {
  const ms = Date.now() - sinceMs;
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

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

function voltageColor(v: number): string {
  if (v >= 12.5) return "text-green-600";
  if (v >= 12.0) return "text-gray-900";
  return "text-red-600";
}

function teamInMatch(m: NexusMatch, team: string): boolean {
  return (
    m.blueTeams?.some((t) => t === team) === true || m.redTeams?.some((t) => t === team) === true
  );
}

// ── Isolated timer components ──────────────────────────────────────────────

function ElapsedTime({ sinceMs }: { sinceMs: number }) {
  const [text, setText] = useState(() => formatElapsed(sinceMs));
  useEffect(() => {
    const interval = setInterval(() => setText(formatElapsed(sinceMs)), 250);
    return () => clearInterval(interval);
  }, [sinceMs]);
  return <>{text}</>;
}

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
            <p className="text-lg font-black text-gray-900">{onDeck.label}</p>
            {onDeck.times.estimatedOnFieldTime && (
              <div>
                <p className="text-[10px] text-gray-600">On field in</p>
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
          className={`rounded-xl p-2.5 border ${teamInMatch(nowQueuing, teamNumber) ? "bg-yellow-100 border-yellow-300 ring-2 ring-yellow-400" : "bg-yellow-100 border-yellow-700"}`}
        >
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-900">
              Now Queuing {teamInMatch(nowQueuing, teamNumber) && "!"}
            </p>
            <p className="text-lg font-black text-gray-900">{nowQueuing.label}</p>
            {nowQueuing.times.estimatedOnFieldTime && (
              <div>
                <p className="text-[10px] text-gray-600">On field in</p>
                <p className="text-sm font-bold text-gray-900 tabular-nums">
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
            <p className="text-lg font-black text-gray-900">{queuingSoon.label}</p>
            {queuingSoon.times.estimatedQueueTime && (
              <div>
                <p className="text-[10px] text-gray-600">Queue in</p>
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
      <h2 className="text-xs font-bold uppercase tracking-widest text-gray-600">
        Upcoming Matches
      </h2>
      <div
        className="bg-white border border-gray-200 rounded-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: "400px" }}
      >
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-gray-200">
              <tr className="text-gray-600 text-xs uppercase tracking-wide">
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
                    className={`border-b border-gray-200/50 last:border-0 ${isOurMatch ? "bg-red-50" : ""}`}
                  >
                    <td
                      className={`px-4 py-2.5 font-semibold ${isOurMatch ? "text-red-700" : "text-gray-900"}`}
                    >
                      {m.label}
                    </td>
                    <td
                      className={`px-4 py-2.5 tabular-nums ${isOurMatch ? "text-red-600 font-semibold" : "text-gray-600"}`}
                    >
                      {m.times.actualQueueTime
                        ? formatTime(m.times.actualQueueTime)
                        : m.times.estimatedQueueTime
                          ? formatTime(m.times.estimatedQueueTime)
                          : "—"}
                    </td>
                    <td
                      className={`px-4 py-2.5 tabular-nums ${isOurMatch ? "text-red-600 font-semibold" : "text-gray-600"}`}
                    >
                      {formatTime(m.times.estimatedStartTime)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          m.blueTeams?.includes(teamNumber)
                            ? "text-blue-600 font-bold bg-blue-100 px-2 py-1 rounded"
                            : "text-gray-600"
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
                            : "text-gray-600"
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
      <h2 className="text-xs font-bold uppercase tracking-widest text-gray-600">Ranking</h2>
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex gap-6 items-start">
          {/* Left: rank info */}
          <div className="flex gap-6 shrink-0">
            {ranking.rank !== null && (
              <p className="text-6xl font-black text-gray-900 leading-none">
                <span className="text-2xl text-gray-600 font-normal">#</span>
                {ranking.rank}
              </p>
            )}
            <div className="space-y-1 text-sm">
              <p className="text-gray-700">
                <span className="text-green-600 font-bold">{ranking.wins}W</span>
                {" — "}
                <span className="text-red-600 font-bold">{ranking.losses}L</span>
                {ranking.ties > 0 && (
                  <>
                    {" — "}
                    <span className="text-gray-600 font-bold">{ranking.ties}T</span>
                  </>
                )}
              </p>
              <p className="text-gray-600">
                <span className="text-gray-900 font-semibold">{ranking.rp}</span> RP
                {ranking.epa > 0 && (
                  <>
                    {" · "}
                    <span className="text-gray-900 font-semibold">{ranking.epa.toFixed(1)}</span>{" "}
                    EPA
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Right: context table if available */}
          {contextRankings && (
            <div className="flex-1 pl-6 border-l border-gray-300">
              <div className="grid grid-cols-2 gap-4">
                {/* Left: context (around us) */}
                <div className="space-y-2">
                  <p className="text-xs text-gray-600 font-semibold">Around Us</p>
                  <div className="space-y-1">
                    {contextRankings.context.map((r) => (
                      <div
                        key={r.team}
                        className={`flex justify-between px-2.5 py-1.5 rounded text-sm ${
                          r.team === teamNumber
                            ? "bg-red-100 text-red-700 font-semibold"
                            : "text-gray-700"
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
                  <p className="text-xs text-gray-600 font-semibold">Top 3</p>
                  <div className="space-y-1">
                    {contextRankings.top3.map((r) => (
                      <div
                        key={r.team}
                        className={`flex justify-between px-2.5 py-1.5 rounded text-sm ${
                          r.team === teamNumber
                            ? "bg-red-100 text-red-700 font-semibold"
                            : "text-gray-700"
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

function BatteriesSection({ batteries }: { batteries: Battery[] }) {
  const inRobot = batteries.find((b) => b.state === "In Robot");
  const nextUp = batteries.find((b) => b.state === "Next Up");
  const longestCharging = batteries
    .filter((b) => b.state === "Charging")
    .sort((a, b) => a.stateSince - b.stateSince)[0];

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-gray-600">Batteries</h2>
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-red-100 border border-red-300 rounded-xl p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-red-600 mb-2">
              In Robot
            </p>
            {inRobot ? (
              <div className="space-y-1">
                <p className="text-xl font-black text-gray-900">{inRobot.name}</p>
                <p className="text-xs text-gray-600">
                  <ElapsedTime sinceMs={inRobot.stateSince} />
                </p>
                {inRobot.voltage != null && (
                  <p
                    className={`text-lg font-bold font-mono tabular-nums ${voltageColor(inRobot.voltage)}`}
                  >
                    {inRobot.voltage.toFixed(2)}V
                  </p>
                )}
              </div>
            ) : (
              <p className="text-gray-600 text-xs">No battery</p>
            )}
          </div>

          <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-2">
              Next Up
            </p>
            {nextUp ? (
              <div className="space-y-1">
                <p className="text-xl font-black text-gray-900">{nextUp.name}</p>
                <p className="text-xs text-gray-600">
                  <ElapsedTime sinceMs={nextUp.stateSince} />
                </p>
                {nextUp.voltage != null && (
                  <p
                    className={`text-lg font-bold font-mono tabular-nums ${voltageColor(nextUp.voltage)}`}
                  >
                    {nextUp.voltage.toFixed(2)}V
                  </p>
                )}
              </div>
            ) : (
              <p className="text-gray-600 text-xs">None</p>
            )}
          </div>

          <div className="bg-blue-100 border border-blue-800 rounded-xl p-3">
            <p className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-2">
              Charging
            </p>
            {longestCharging ? (
              <div className="space-y-1">
                <p className="text-xl font-black text-gray-900">{longestCharging.name}</p>
                <p className="text-xs text-gray-600 tabular-nums">
                  <ElapsedTime sinceMs={longestCharging.stateSince} />
                </p>
              </div>
            ) : (
              <p className="text-gray-600 text-xs">None</p>
            )}
          </div>
        </div>
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
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-600">
          Checklist Progress
        </h2>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span
              className={`text-sm font-semibold ${allDone ? "text-green-600" : "text-gray-700"}`}
            >
              {allDone ? "All done!" : `${totalChecked} / ${totalItems} complete`}
            </span>
            <span
              className={`text-lg font-black tabular-nums ${allDone ? "text-green-600" : "text-gray-900"}`}
            >
              {globalPct}%
            </span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${allDone ? "bg-green-500" : "bg-red-500"}`}
              style={{ width: `${globalPct}%` }}
            />
          </div>
        </div>
        <div className="space-y-2">
          {lists.map((list) => {
            const pct =
              list.itemCount > 0 ? Math.round((list.checkedCount / list.itemCount) * 100) : 0;
            const done = list.itemCount > 0 && list.checkedCount === list.itemCount;
            return (
              <div key={list.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 truncate">{list.name}</span>
                  <span
                    className={`text-sm font-semibold tabular-nums shrink-0 ml-3 ${done ? "text-green-600" : "text-gray-700"}`}
                  >
                    {list.checkedCount}/{list.itemCount}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${done ? "bg-green-500" : "bg-red-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Issues */}
      <div className="space-y-2 pt-2 border-t border-gray-200">
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-600">
          Open Issues{" "}
          {issues.length > 0 && <span className="text-gray-900 normal-case">{issues.length}</span>}
        </h2>
        {issues.length === 0 ? (
          <p className="text-green-600 text-sm font-semibold">No open issues ✓</p>
        ) : (
          <div className="space-y-2">
            {issues.map((issue) => (
              <div
                key={issue.id}
                className="bg-yellow-100 border border-yellow-300 rounded-xl px-4 py-3"
              >
                <p className="text-sm text-gray-900/90 leading-snug">{issue.text}</p>
                <p className="text-xs text-gray-600 mt-0.5">
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
  const { isFullscreen, setFullscreen } = useFullscreen();
  const { setBatteries: setCachedBatteries } = useBatteryCache();
  const [batteries, setBatteries] = useState<Battery[]>([]);
  const [lists, setLists] = useState<ChecklistList[]>([]);
  const [issues, setIssues] = useState<ChecklistIssueSummary[]>([]);
  const [monitor, setMonitor] = useState<MonitorData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);

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
    const [b, l, i, m] = await Promise.all([
      fetchBatteries().catch(() => [] as Battery[]),
      fetchLists().catch(() => [] as ChecklistList[]),
      fetchAllIssues().catch(() => [] as ChecklistIssueSummary[]),
      api.monitor.data
        .$get()
        .then((r) => (r.ok ? (r.json() as Promise<MonitorData>) : null))
        .catch(() => null),
    ]);
    setBatteries(b);
    setCachedBatteries(b);
    setLists(l);
    setIssues(i);
    setMonitor(m);
    setLastUpdated(new Date());
    setLoading(false);
  }

  async function loadSettings() {
    const response = await api.monitor.settings.$get();
    if (!response.ok) return;
    const settings = (await response.json()) as { iframeUrl?: string };
    setIframeUrl(settings.iframeUrl ?? null);
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
      <main className="min-h-screen bg-page flex items-center justify-center">
        <p className="text-gray-600 text-lg">Loading…</p>
      </main>
    );
  }

  const teamNumber = monitor?.teamNumber ?? "";
  const hasNexus = !!monitor?.nexus;
  const nexus = monitor?.nexus;

  return (
    <main className="min-h-screen bg-page text-gray-900">
      <div className="px-6 py-5 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-4">
          <h1 className="text-2xl font-black tracking-tight">{appTitle("Pit")} Monitor</h1>
          <div className="flex items-center gap-4">
            {lastUpdated && (
              <p className="text-xs text-gray-600">Updated {lastUpdated.toLocaleTimeString()}</p>
            )}
            <button
              type="button"
              onClick={handleFullscreen}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-900 text-sm font-semibold rounded-lg transition-colors"
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? "Exit" : "⛶ Fullscreen"}
            </button>
          </div>
        </div>

        {/* Nexus status — full width, only if real Nexus data available */}
        {nexus?.isRealNexus && <NexusSection nexus={nexus} teamNumber={teamNumber} />}

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: ranking + upcoming matches */}
          <div className="space-y-5">
            {monitor?.ranking && (
              <RankingSection
                ranking={monitor.ranking}
                contextRankings={monitor.contextRankings}
                teamNumber={teamNumber}
              />
            )}
            {hasNexus && nexus && <UpcomingMatchesSection nexus={nexus} teamNumber={teamNumber} />}
          </div>

          {/* Right: custom iframe + batteries + checklist + issues */}
          <div className="space-y-5">
            {iframeUrl && (
              <div className="space-y-2">
                <h2 className="text-xs font-bold uppercase tracking-widest text-gray-600">
                  Monitor Feed
                </h2>
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
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
            <BatteriesSection batteries={batteries} />
            <ChecklistSection lists={lists} issues={issues} />
          </div>
        </div>
      </div>
    </main>
  );
}
