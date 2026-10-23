import { Badge, Button, ProgressBar, tones, useTeamNames } from "@g3/ui";
import type { OurSchedule } from "@g3/worker-pit/monitor-matches";
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
import { useAuth } from "../../shared/use-auth";
import { ConnectionIndicator, OfflineOverlay, useConnection } from "./connection";
import { Countdown, formatTime } from "./match-time";
import { OurNextMatchPanel } from "./our-next-match";
import { SnapshotClock } from "./snapshot-clock";

const REFRESH_MS = 15_000;

/**
 * The match list and the checklists, the tallest parts: on a wide screen each shrinks to what's
 * left of its column and scrolls inside, and on a narrow one it's never taller than the window.
 */
const SCROLL_SECTION = "flex min-h-40 max-h-[80dvh] shrink flex-col xl:max-h-none";
/** Wide enough for three columns (Tailwind's xl). */
const WIDE = "(min-width: 1280px)";
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
type MatchResult = {
  red: number;
  blue: number;
  winner: "red" | "blue" | "tie";
  /** Which bonus ranking points each alliance earned (qualification matches). */
  bonus?: { labels: string[]; red: boolean[]; blue: boolean[] } | null;
};

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
  snapshot?: { event: string; name: string; clockMs: number } | null;
  nexus: NexusData | null;
  /** The team's next match; null when there's no schedule. */
  ourMatches?: OurSchedule | null;
  ranking: RankingRow | null;
  contextRankings?: ContextRankings | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── Sections ───────────────────────────────────────────────────────────────

/**
 * One of the event's up-next matches, laid out like a battery tile: its place in the queue, the
 * match, and when it's due on the field or to queue.
 */
function QueueTile({
  title,
  match,
  colors,
  ours,
  until,
}: {
  title: string;
  match: NexusMatch;
  colors: string;
  ours: boolean;
  until: { label: string; at: number | null | undefined };
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border px-3 py-2 ${colors} ${ours ? "ring-2 ring-current" : ""}`}
    >
      <p className="flex items-baseline justify-between gap-2 text-xs font-bold uppercase tracking-widest">
        <span className="truncate">{title}</span>
        {ours && <span className="shrink-0">Us</span>}
      </p>
      <p className="truncate text-xl font-black text-secondary-900">
        {match.label.replace(/^Qualification\b/, "Qual")}
      </p>
      {/* Kept a line tall without a time, so the three tiles stay the same height. */}
      <p className="min-h-4 truncate text-xs tabular-nums text-secondary-600">
        {until.at && (
          <>
            {until.label} <Countdown targetMs={until.at} />
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Where the event is: the matches On deck, Now queuing and Queuing soon, three across like the
 * batteries when their column is wide enough.
 */
function NexusSection({ nexus, teamNumber }: { nexus: NexusData; teamNumber: string }) {
  const onDeck = nexus.matches.find((m) => m.status === "On deck");
  const nowQueuing = nexus.matches.find((m) => m.status === "Now queuing");
  const queuingSoon = nexus.matches.find((m) => m.status === "Queuing soon");

  if (!onDeck && !nowQueuing && !queuingSoon) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">Up next</h2>
      <div className="@container bg-surface border border-secondary-200 rounded-xl p-3 sm:p-4">
        <div className="grid gap-2 @md:grid-cols-3 @md:gap-3">
          {onDeck && (
            <QueueTile
              title="On deck"
              match={onDeck}
              colors="border-red-300 bg-red-50 text-red-700"
              ours={teamInMatch(onDeck, teamNumber)}
              until={{ label: "On field in", at: onDeck.times.estimatedOnFieldTime }}
            />
          )}
          {nowQueuing && (
            <QueueTile
              title="Now queuing"
              match={nowQueuing}
              colors="border-amber-300 bg-amber-50 text-amber-700"
              ours={teamInMatch(nowQueuing, teamNumber)}
              until={{ label: "On field in", at: nowQueuing.times.estimatedOnFieldTime }}
            />
          )}
          {queuingSoon && (
            <QueueTile
              title="Queuing soon"
              match={queuingSoon}
              colors="border-emerald-300 bg-emerald-50 text-emerald-700"
              ours={teamInMatch(queuingSoon, teamNumber)}
              until={{ label: "Queue in", at: queuingSoon.times.estimatedQueueTime }}
            />
          )}
        </div>
      </div>
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
 * A played qualification match's bonus ranking points for one alliance, as The Blue Alliance shows
 * them: a filled dot for each one earned, an empty one for each not.
 */
function RpDots({ match, side }: { match: NexusMatch; side: "red" | "blue" }) {
  const bonus = match.result?.bonus;
  if (!bonus) return null;
  const earned = bonus.labels.filter((_, index) => bonus[side][index]);
  return (
    <span
      role="img"
      aria-label={earned.length ? earned.join(", ") : "No bonus RPs"}
      className="inline-flex gap-0.5"
    >
      {bonus[side].map((got, index) => (
        <span
          key={bonus.labels[index]}
          title={bonus.labels[index]}
          className={`size-2 rounded-full ${
            got ? (side === "red" ? "bg-red-600" : "bg-blue-600") : "border border-secondary-400"
          }`}
        />
      ))}
    </span>
  );
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
                <th className="text-left px-2 py-2 font-semibold">Match</th>
                <th className="text-left px-2 py-2 font-semibold">Queue</th>
                <th className="text-left px-2 py-2 font-semibold">Blue</th>
                <th colSpan={2} className="px-2 py-2 text-center font-semibold">
                  Score
                </th>
                <th className="text-left px-2 py-2 font-semibold">Red</th>
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
                      className={`whitespace-nowrap px-2 py-2.5 font-semibold ${played ? "text-secondary-900" : "text-primary-700"}`}
                    >
                      {m.label.replace(/^Qualification\b/, "Qual")}
                    </td>
                    {played ? (
                      <td className="px-2 py-2.5 text-base">
                        <MatchOutcome match={m} teamNumber={teamNumber} />
                      </td>
                    ) : (
                      <td className="whitespace-nowrap px-2 py-2.5 tabular-nums font-semibold text-primary-600">
                        {m.times.actualQueueTime
                          ? formatTime(m.times.actualQueueTime)
                          : m.times.estimatedQueueTime
                            ? formatTime(m.times.estimatedQueueTime)
                            : "—"}
                      </td>
                    )}
                    <td className="px-2 py-2.5">
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
                    <td className="py-2.5 pl-2 pr-1 tabular-nums">
                      <span className="flex items-center justify-end gap-1.5">
                        <RpDots match={m} side="blue" />
                        <Score match={m} side="blue" />
                      </span>
                    </td>
                    <td className="py-2.5 pl-1 pr-2 tabular-nums">
                      <span className="flex items-center gap-1.5">
                        <Score match={m} side="red" />
                        <RpDots match={m} side="red" />
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
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
      <div className="@container bg-surface border border-secondary-200 rounded-xl p-5">
        {/* Side by side where the column is wide enough, else the rankings around us under it. */}
        <div className="flex flex-col gap-4 @lg:flex-row @lg:items-start @lg:gap-6">
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
            <div className="flex-1 border-t border-secondary-300 pt-4 @lg:border-t-0 @lg:border-l @lg:pt-0 @lg:pl-6">
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

/**
 * One of the Monitor's three batteries, in its state's color, on two lines: its state and how long
 * it has been in it, then its name and voltage.
 */
function BatteryTile({
  label,
  battery,
  state,
  none,
}: { label: string; battery: Battery | undefined; state: BatteryState; none: string }) {
  return (
    <div className={`min-w-0 rounded-xl border px-3 py-2 ${STATE_TONES[state]}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-xs font-bold uppercase tracking-widest">{label}</p>
        {battery && (
          <p className="shrink-0 text-xs tabular-nums text-secondary-600">
            <ElapsedTime battery={battery} />
          </p>
        )}
      </div>
      {battery ? (
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-xl font-black text-secondary-900">{battery.name}</p>
          {state !== "Charging" && battery.voltage != null && (
            <p
              className={`shrink-0 font-mono text-lg font-bold tabular-nums ${voltageColor(battery.voltage)}`}
            >
              {battery.voltage.toFixed(2)}V
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-secondary-600">{none}</p>
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
      <div className="@container bg-surface border border-secondary-200 rounded-xl p-3 sm:p-4">
        <div className="grid gap-2 @md:grid-cols-3 @md:gap-3">
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
  // Admins move the event snapshot's clock (dev and staging only).
  const isAdmin = useAuth().user?.isAdmin === true;

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
      <div className="px-4 py-5 space-y-5 sm:px-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-secondary-200 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight">{names.appTitle("Pit")} Monitor</h1>
            {monitor?.snapshot && (
              <Badge colors={tones.warning}>Snapshot: {monitor.snapshot.name}</Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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

        {monitor?.snapshot && isAdmin && (
          <SnapshotClock clockMs={monitor.snapshot.clockMs} onMoved={() => void loadAll()} />
        )}

        {/* Main grid: three columns on a wide screen, ending at the bottom of the window. Our next
            match takes the left two; under it, the match list (scrolling inside its column) and
            the ranking, who's in the pit and the logs. The right column is up next, batteries, the
            feed and the checklists (scrolling). On a narrower screen the areas' wrappers are
            `contents` and every part is in one column, ordered by `order`: our match, then up
            next, the pit and batteries. */}
        <div
          ref={gridRef}
          className="grid grid-cols-1 gap-5 xl:grid-cols-3 xl:grid-rows-[minmax(0,1fr)]"
          style={fitHeight ? { height: fitHeight } : undefined}
        >
          <div className="contents xl:col-span-2 xl:flex xl:min-h-0 xl:flex-col xl:gap-5">
            <div className="order-1 xl:order-none">
              <OurNextMatchPanel
                ourMatches={monitor?.ourMatches ?? null}
                fromNexus={!!nexus?.isRealNexus}
                teamNumber={teamNumber}
              />
            </div>
            <div className="contents xl:grid xl:min-h-0 xl:flex-1 xl:grid-cols-2 xl:grid-rows-[minmax(0,1fr)] xl:gap-5">
              {hasNexus && nexus && (
                <div className={`order-5 xl:order-none ${SCROLL_SECTION}`}>
                  <MatchesSection nexus={nexus} teamNumber={teamNumber} />
                </div>
              )}
              <div className="contents xl:col-start-2 xl:flex xl:min-h-0 xl:flex-col xl:gap-5 xl:overflow-y-auto">
                {monitor?.ranking && (
                  <div className="order-6 xl:order-none">
                    <RankingSection
                      ranking={monitor.ranking}
                      contextRankings={monitor.contextRankings}
                      teamNumber={teamNumber}
                    />
                  </div>
                )}
                {inThePit && (
                  <div className="order-3 xl:order-none">
                    <InThePitSection people={inThePit} />
                  </div>
                )}
                {logsBox && (
                  <div className="order-7 xl:order-none">
                    <LogsSection downloader={logsBox.downloader} logs={logsBox.logs} />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="contents xl:flex xl:min-h-0 xl:flex-col xl:gap-5">
            {nexus?.isRealNexus && (
              <div className="order-2 xl:order-none">
                <NexusSection nexus={nexus} teamNumber={teamNumber} />
              </div>
            )}
            <div className="order-4 xl:order-none">
              <BatteriesSection batteries={batteries} />
            </div>
            {iframeUrl && (
              <div className="order-9 space-y-2 xl:order-none">
                <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">
                  Monitor Feed
                </h2>
                <div className="bg-surface border border-secondary-200 rounded-xl overflow-hidden">
                  <iframe
                    src={iframeUrl}
                    title="Custom monitor feed"
                    className="aspect-video w-full"
                    frameBorder="0"
                    allowFullScreen
                  />
                </div>
              </div>
            )}
            <div className={`order-8 xl:order-none ${SCROLL_SECTION}`}>
              <ChecklistSection lists={lists} issues={issues} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
