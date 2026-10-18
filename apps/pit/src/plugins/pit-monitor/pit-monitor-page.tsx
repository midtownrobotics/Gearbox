import { Badge, Button, ProgressBar, tones, useTeamNames } from "@g3/ui";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../shared/api";
import { useBatteryCache } from "../../shared/battery-cache-context";
import { ElapsedTime, STATE_TONES, timerMs, voltageColor } from "../../shared/battery-display";
import { DownloaderStatusRows, currentDownloader } from "../../shared/downloader-status";
import { useFullscreen } from "../../shared/fullscreen-context";
import { fetchBatteries } from "../../shared/getters/batteries";
import {
  type LogDownloader,
  type MatchLog,
  fetchDownloaders,
  fetchMatchLogs,
} from "../../shared/getters/downloaders";
import { fetchAllIssues } from "../../shared/getters/issues";
import { fetchLists } from "../../shared/getters/lists";
import type {
  Battery,
  BatteryState,
  ChecklistIssueSummary,
  ChecklistList,
} from "../../shared/getters/types";
import { type PersonInThePit, untilLabel, useInThePit } from "../../shared/in-the-pit";
import { ConnectionIndicator, OfflineOverlay, useConnection } from "./connection";

const REFRESH_MS = 15_000;

/**
 * The match list and the checklists, the tallest parts: on a wide screen each shrinks to what's
 * left of its column and scrolls inside, and on a narrow one it's never taller than the window.
 */
const SCROLL_SECTION = "flex min-h-40 max-h-[80dvh] shrink flex-col lg:max-h-none";
/** Wide enough for two columns (Tailwind's lg). */
const WIDE = "(min-width: 1024px)";
/** Space under the columns, the page's own padding. */
const BOTTOM_GAP = 20;
/** Below this, the columns aren't fit to the window: the page scrolls instead. */
const MIN_FIT_HEIGHT = 480;

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

/** A played match's score, from The Blue Alliance. */
type MatchResult = { red: number; blue: number; winner: "red" | "blue" | "tie" };

type NexusMatch = {
  label: string;
  status: "Queuing soon" | "Now queuing" | "On deck" | "On field";
  redTeams?: (string | null | undefined)[] | null;
  blueTeams?: (string | null | undefined)[] | null;
  times: NexusMatchTime;
  /** Null until it's been played (and always for practice matches). */
  result?: MatchResult | null;
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
  /** A past event shown instead of the team's (dev and staging only: Pit > Admin). */
  snapshot?: { event: string; name: string } | null;
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

/**
 * How tall an element can be to end at the bottom of the window, on a wide screen; null on a
 * narrow one, or when too little of the window is left.
 */
function useFitToWindow(ref: RefObject<HTMLElement | null>, ready: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!ready || !element) return;
    const wide = window.matchMedia(WIDE);
    const measure = () => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      const fits = window.innerHeight - top - BOTTOM_GAP;
      setHeight(wide.matches && fits >= MIN_FIT_HEIGHT ? fits : null);
    };
    measure();
    // Anything above it changing size (the bar hidden in full screen, a banner) moves it.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    wide.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      wide.removeEventListener("change", measure);
    };
  }, [ref, ready]);
  return height;
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

/** The team's result in a played match: a green W, a red L, or a gray T. */
function MatchOutcome({ match, teamNumber }: { match: NexusMatch; teamNumber: string }) {
  const result = match.result;
  if (!result) return null;
  const ourSide = match.redTeams?.includes(teamNumber) ? "red" : "blue";
  if (result.winner === "tie") {
    return <span className="font-black text-secondary-500">T</span>;
  }
  return result.winner === ourSide ? (
    <span className="font-black text-emerald-600">W</span>
  ) : (
    <span className="font-black text-red-600">L</span>
  );
}

/** A score, bold for the winner; "—" before the match is played. */
function Score({
  match,
  side,
}: {
  match: NexusMatch;
  side: "red" | "blue";
}) {
  const result = match.result;
  const color = side === "red" ? "text-red-700" : "text-blue-700";
  if (!result) return <span className="text-secondary-400">—</span>;
  const won = result.winner === side;
  return <span className={`${color} ${won ? "font-black" : "font-medium"}`}>{result[side]}</span>;
}

/**
 * The team's matches at the event, played ones with their scores. The list scrolls so the next
 * match is near the top, with the last one played above it.
 */
function MatchesSection({
  nexus,
  teamNumber,
}: {
  nexus: NexusData;
  teamNumber: string;
}) {
  const matches = nexus.matches.filter((m) => teamInMatch(m, teamNumber));
  const scrollerRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLTableSectionElement>(null);
  const nextIndex = matches.findIndex((m) => !m.result);
  const nextLabel = nextIndex >= 0 ? matches[nextIndex].label : null;

  // When the next match changes, and when the list's size or its rows' do (it's fit to the
  // window once the page has its data, and the team's font may load after).
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls only when the next match changes
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || nextIndex < 0) return;
    const toNext = () => {
      const row = scroller.querySelectorAll("tbody tr")[Math.max(0, nextIndex - 1)];
      if (!row) return;
      scroller.scrollTop +=
        row.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        (headRef.current?.offsetHeight ?? 0);
    };
    toNext();
    const observer = new ResizeObserver(toNext);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, [nextLabel]);

  if (matches.length === 0) return null;

  return (
    <div className={`${SCROLL_SECTION} space-y-2`}>
      <h2 className="shrink-0 text-xs font-bold uppercase tracking-widest text-secondary-600">
        Matches
      </h2>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-secondary-200 bg-surface">
        <div ref={scrollerRef} className="min-h-0 overflow-y-auto">
          <table className="w-full text-sm">
            <thead
              ref={headRef}
              className="sticky top-0 z-10 bg-surface shadow-[inset_0_-1px_0_var(--g3-line)]"
            >
              <tr className="text-secondary-600 text-xs uppercase tracking-wide">
                <th className="text-left px-3 py-2 font-semibold">Match</th>
                <th className="text-left px-3 py-2 font-semibold">Queue</th>
                <th className="text-left px-3 py-2 font-semibold">Start</th>
                <th className="text-left px-3 py-2 font-semibold">Blue</th>
                <th colSpan={2} className="px-2 py-2 text-center font-semibold">
                  Score
                </th>
                <th className="text-left px-3 py-2 font-semibold">Red</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => {
                const played = !!m.result;
                return (
                  <tr
                    key={m.label}
                    className={`border-b border-secondary-200/50 last:border-0 ${played ? "" : "bg-primary-50"}`}
                  >
                    <td
                      className={`whitespace-nowrap px-3 py-2.5 font-semibold ${played ? "text-secondary-900" : "text-primary-700"}`}
                    >
                      {m.label.replace(/^Qualification\b/, "Qual")}
                    </td>
                    {played ? (
                      <td colSpan={2} className="px-3 py-2.5 text-base">
                        <MatchOutcome match={m} teamNumber={teamNumber} />
                      </td>
                    ) : (
                      <>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums font-semibold text-primary-600">
                          {m.times.actualQueueTime
                            ? formatTime(m.times.actualQueueTime)
                            : m.times.estimatedQueueTime
                              ? formatTime(m.times.estimatedQueueTime)
                              : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 tabular-nums font-semibold text-primary-600">
                          {formatTime(m.times.estimatedStartTime)}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2.5">
                      <span
                        className={
                          m.blueTeams?.includes(teamNumber)
                            ? "whitespace-nowrap rounded bg-blue-100 px-2 py-1 font-bold text-blue-600"
                            : "whitespace-nowrap text-secondary-600"
                        }
                      >
                        {m.blueTeams?.filter(Boolean).join(", ")}
                      </span>
                    </td>
                    <td className="py-2.5 pl-2 pr-1 text-right tabular-nums">
                      <Score match={m} side="blue" />
                    </td>
                    <td className="py-2.5 pl-1 pr-2 text-left tabular-nums">
                      <Score match={m} side="red" />
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={
                          m.redTeams?.includes(teamNumber)
                            ? "whitespace-nowrap rounded bg-red-100 px-2 py-1 font-bold text-red-600"
                            : "whitespace-nowrap text-secondary-600"
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
            <ElapsedTime battery={battery} />
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
  const now = Date.now();
  const longestCharging = batteries
    .filter((b) => b.state === "Charging")
    .sort((a, b) => timerMs(b, now) - timerMs(a, now))[0];

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

/** What the team's log downloader is doing, and its newest match logs. */
function LogsSection({ downloader, logs }: { downloader: LogDownloader | null; logs: MatchLog[] }) {
  const when = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">Logs</h2>
      <div className="bg-surface border border-secondary-200 rounded-xl p-5">
        {downloader && (
          <div className="mb-3 border-b border-secondary-200 pb-3">
            <DownloaderStatusRows downloader={downloader} />
          </div>
        )}
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
    <div className={`${SCROLL_SECTION} gap-3`}>
      {/* Overall progress stays at the top; the lists and issues scroll under it. */}
      <div className="shrink-0 space-y-3">
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
      </div>
      <div className="min-h-0 space-y-4 overflow-y-auto">
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
  // The log downloader's status and the newest match logs, while the team has a paired
  // downloader; null hides the box.
  const [logsBox, setLogsBox] = useState<{
    downloader: LogDownloader | null;
    logs: MatchLog[];
  } | null>(null);
  const connection = useConnection();
  const gridRef = useRef<HTMLDivElement>(null);
  const fitHeight = useFitToWindow(gridRef, !loading);
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
    // Each part is kept as it was when it couldn't be asked (undefined), never blanked.
    const [b, l, i, m, logs] = await Promise.all([
      fetchBatteries().catch(() => undefined),
      fetchLists().catch(() => undefined),
      fetchAllIssues().catch(() => undefined),
      api.monitor.data
        .$get()
        .then((r) => (r.ok ? (r.json() as Promise<MonitorData>) : undefined))
        .catch(() => undefined),
      fetchDownloaders()
        .then(async ({ downloaders }) =>
          downloaders.length
            ? {
                downloader: currentDownloader(downloaders),
                logs: (await fetchMatchLogs()).logs.slice(0, 3),
              }
            : null,
        )
        .catch(() => undefined),
    ]);
    if (b !== undefined) {
      setBatteries(b);
      setCachedBatteries(b);
    }
    if (l !== undefined) setLists(l);
    if (i !== undefined) setIssues(i);
    if (m !== undefined) setMonitor(m);
    if (logs !== undefined) setLogsBox(logs);
    if ([b, l, i, m, logs].every((part) => part !== undefined)) setLastUpdated(new Date());
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

  // Back online: catch up at once instead of waiting for the next refresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadAll is stable
  useEffect(() => {
    if (connection.online && !loading) void loadAll();
  }, [connection.online]);

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
      <OfflineOverlay connection={connection} />
      <div className="px-6 py-5 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-secondary-200 pb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight">{names.appTitle("Pit")} Monitor</h1>
            {monitor?.snapshot && (
              <Badge colors={tones.warning}>Snapshot: {monitor.snapshot.name}</Badge>
            )}
          </div>
          <div className="flex items-center gap-4">
            <ConnectionIndicator connection={connection} />
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

        {/* Main grid: on a wide screen it ends at the bottom of the window, and the match list
            and checklists scroll inside their columns instead of the page scrolling. */}
        <div
          ref={gridRef}
          className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]"
          style={fitHeight ? { height: fitHeight } : undefined}
        >
          {/* Left: Nexus status (only with real Nexus data) + ranking + the team's matches. In the
              column, so the right one starts at the top instead of under it. */}
          <div className="flex min-h-0 flex-col gap-5">
            {inThePit && <InThePitSection people={inThePit} />}
            {nexus?.isRealNexus && <NexusSection nexus={nexus} teamNumber={teamNumber} />}
            {monitor?.ranking && (
              <RankingSection
                ranking={monitor.ranking}
                contextRankings={monitor.contextRankings}
                teamNumber={teamNumber}
              />
            )}
            {hasNexus && nexus && <MatchesSection nexus={nexus} teamNumber={teamNumber} />}
          </div>

          {/* Right: the stream (when set) + logs + batteries + checklist + issues */}
          <div className="flex min-h-0 flex-col gap-5">
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
            {logsBox && <LogsSection downloader={logsBox.downloader} logs={logsBox.logs} />}
            <BatteriesSection batteries={batteries} />
            <ChecklistSection lists={lists} issues={issues} />
          </div>
        </div>
      </div>
    </main>
  );
}
