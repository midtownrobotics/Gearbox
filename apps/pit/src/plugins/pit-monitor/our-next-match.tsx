import type { OurNextMatch, OurSchedule } from "@g3/worker-pit/monitor-matches";
import type { ReactNode } from "react";
import { Countdown, formatTime } from "./match-time";

// The Monitor's "Our next match": where the team's next match is, how many matches until it's
// called to queue (then until it's on the field), and the countdowns. Its colors say how close it
// is: calm while it's far off, then green, amber and red as it nears the field.

type Urgency = "later" | "soon" | "queuing" | "deck" | "field";

const URGENCY: Record<Urgency, { card: string; accent: string }> = {
  later: {
    card: "border-secondary-200 bg-surface",
    accent: "text-secondary-900",
  },
  soon: {
    card: "border-emerald-300 bg-emerald-50",
    accent: "text-emerald-700",
  },
  queuing: {
    card: "border-amber-400 bg-amber-50 ring-2 ring-amber-300",
    accent: "text-amber-700",
  },
  deck: {
    card: "border-red-400 bg-red-50 ring-2 ring-red-300",
    accent: "text-red-700",
  },
  field: {
    card: "border-red-500 bg-red-50 ring-4 ring-red-500",
    accent: "text-red-700",
  },
};

/** How close it is: Nexus's status, else how many matches are left before it. */
function urgencyOf(next: OurNextMatch): Urgency {
  if (next.status === "On field") return "field";
  if (next.status === "On deck") return "deck";
  if (next.status === "Now queuing") return "queuing";
  // Nexus: called within two matches. The Blue Alliance (no calls): on the field within four.
  const near =
    next.matchesUntilQueuing !== null ? next.matchesUntilQueuing <= 2 : next.matchesUntilField <= 4;
  return near ? "soon" : "later";
}

/**
 * The field's colors: a pale tint with a bright, heavy border, so the alliances stand out from the
 * page's thin -300 borders while keeping its look in both themes.
 */
const ALLIANCE = {
  red: {
    name: "Red alliance",
    tint: "bg-red-100",
    border: "border-red-500",
    text: "text-red-800",
    timer: "text-red-700",
  },
  blue: {
    name: "Blue alliance",
    tint: "bg-blue-100",
    border: "border-blue-500",
    text: "text-blue-800",
    timer: "text-blue-700",
  },
};

/**
 * The page's lightest body text: a team's rank and pit address beside its number, shown only when
 * its alliance's half is wide enough for them (a container query on the half).
 */
const QUIET = "hidden text-sm font-normal text-secondary-500 @md:inline";

/** One team: its rank, its number and its pit; ours together on a card ringed in white. */
function TeamSlot({
  team,
  ours,
  color,
  rank,
  pit,
}: { team: string; ours: boolean; color: string; rank?: number; pit?: string }) {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 sm:px-2 ${
        ours ? "bg-surface shadow-md ring-[3px] ring-white" : ""
      }`}
    >
      {rank !== undefined && <span className={`tabular-nums ${QUIET}`}>#{rank}</span>}
      <span
        className={`text-base tabular-nums sm:text-2xl ${color} ${ours ? "font-black" : "font-semibold"}`}
      >
        {team || "—"}
      </span>
      {pit && <span className={QUIET}>{pit}</span>}
    </span>
  );
}

/** One alliance's teams by station, each centered in its third with what's known about it. */
function AllianceTeams({
  side,
  next,
  teamNumber,
  className,
  children,
}: {
  side: "red" | "blue";
  next: OurNextMatch;
  teamNumber: string;
  className: string;
  children?: ReactNode;
}) {
  const alliance = ALLIANCE[side];
  const teams = side === "red" ? next.redTeams : next.blueTeams;
  return (
    <div
      className={`@container grid grid-cols-3 items-center justify-items-center gap-1 px-1 sm:px-2 ${className}`}
    >
      <span className="sr-only">{alliance.name}:</span>
      {(teams.length ? teams : [""]).map((team, station) => (
        <TeamSlot
          // Stations keep their place, even for a team not known yet.
          // biome-ignore lint/suspicious/noArrayIndexKey: a station is its place in the list
          key={station}
          team={team}
          ours={team === teamNumber}
          color={alliance.text}
          rank={next.ranks[team]}
          pit={next.pits[team]}
        />
      ))}
      {children}
    </div>
  );
}

/** How round the board's corners are: Tailwind's rounded-xl, and the borders' width. */
const RADIUS = 12;
const EDGE = 3;
/** How far the other alliance's half reaches in under ours, to show in our tab's rounded corners. */
const TUCK = RADIUS + EDGE;

/**
 * A rounded top corner of the other alliance's half, where it meets the bar: our tint, with a
 * quarter circle of theirs whose border carries the bar's edge round and down the side. Drawn at
 * both its top corners, the one by our tab (`inset` `TUCK - EDGE`, as that half reaches in under
 * ours) and the outside one (`inset` `-EDGE`, out over its own border: positions count from inside
 * the border), so it sits behind the bar like a tab in a browser, upside down.
 */
function TabCorner({
  ours,
  theirs,
  side,
  inset,
}: { ours: "red" | "blue"; theirs: "red" | "blue"; side: "left" | "right"; inset: number }) {
  const size = RADIUS + EDGE;
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute z-20 overflow-hidden ${ALLIANCE[ours].tint}`}
      style={{ top: -EDGE, [side]: inset, width: size, height: size }}
    >
      <span
        className={`absolute top-0 rounded-full border-[3px] ${ALLIANCE[ours].border} ${ALLIANCE[theirs].tint}`}
        style={{ [side]: 0, width: size * 2, height: size * 2 }}
      />
    </span>
  );
}

/**
 * The match as one rectangle: a bar in our alliance's color with the match and its countdowns,
 * and the alliances under it like browser tabs upside down. Ours is the open tab: it covers the
 * bar's lower edge and merges into it, with its border down its outside, its bottom and the
 * middle. The other alliance sits behind, under the bar's edge and our tab's middle border, so
 * only its bottom and outside edges show. Blue is always on the left and red on the right.
 */
function AllianceBoard({
  next,
  teamNumber,
  times,
  note,
}: {
  next: OurNextMatch;
  teamNumber: string;
  times: { label: string; at: number }[];
  note: string | null;
}) {
  const ours = next.alliance;
  const theirs = ours === "red" ? "blue" : "red";
  const style = ALLIANCE[ours];
  // Which outside corner each half rounds.
  const corner = { blue: "rounded-bl-xl", red: "rounded-br-xl" };
  // The other half reaches TUCK in under our tab (padded back, so its teams stay put), so its tint
  // and bottom border show in our tab's rounded bottom corner in the middle.
  const tuck = {
    red: "-ml-[15px] pl-[19px] sm:pl-[23px] border-l-0",
    blue: "-mr-[15px] pr-[19px] sm:pr-[23px] border-r-0",
  };
  const tab = (side: "red" | "blue") =>
    side === ours
      ? // Up over the bar's 3px edge, padded back down so both halves' teams line up; both bottom
        // corners rounded, like a tab.
        `relative z-10 -mt-[3px] rounded-b-xl border-[3px] border-t-0 pt-[calc(0.5rem+3px)] pb-2 ${style.border} ${style.tint}`
      : `relative border-[3px] border-t-0 py-2 ${tuck[side]} ${corner[side]} ${ALLIANCE[side].border} ${ALLIANCE[side].tint}`;
  return (
    // The bar keeps its own height; the alliances take any the status box adds.
    <div className="grid min-w-0 grid-cols-2 grid-rows-[auto_1fr]">
      <div
        className={`col-span-2 flex flex-wrap items-center justify-between gap-x-10 gap-y-2 rounded-t-xl border-[3px] px-5 py-3 sm:px-8 ${style.border} ${style.tint}`}
      >
        <div className="min-w-0">
          <p className="text-3xl font-black text-secondary-900 sm:text-4xl">{next.label}</p>
          {note && <p className="text-xs text-secondary-600">{note}</p>}
        </div>
        {times.length > 0 ? (
          <div className="flex gap-10">
            {times.map((time) => (
              <Time key={time.label} label={time.label} at={time.at} color={style.timer} />
            ))}
          </div>
        ) : (
          // No countdown (we're on the field): an unseen one keeps the bar its height.
          <div aria-hidden className="invisible text-center">
            <p className={TIME_LABEL}>Queue</p>
            <p className={TIME_COUNT}>0m 00s</p>
          </div>
        )}
      </div>
      {(["blue", "red"] as const).map((side) => (
        <AllianceTeams
          key={side}
          side={side}
          next={next}
          teamNumber={teamNumber}
          className={tab(side)}
        >
          {side === theirs && (
            <>
              {/* By our tab, then the outside edge. */}
              <TabCorner
                ours={ours}
                theirs={theirs}
                side={ours === "blue" ? "left" : "right"}
                inset={TUCK - EDGE}
              />
              <TabCorner
                ours={ours}
                theirs={theirs}
                side={ours === "blue" ? "right" : "left"}
                inset={-EDGE}
              />
            </>
          )}
        </AllianceTeams>
      ))}
    </div>
  );
}

const TIME_LABEL =
  "flex flex-wrap items-baseline justify-center gap-x-2 text-xs font-semibold uppercase tracking-wide text-secondary-600";
const TIME_COUNT = "text-3xl font-black tabular-nums sm:text-5xl";

/** A countdown under its label and clock time, in our alliance's color. */
function Time({ label, at, color }: { label: string; at: number; color: string }) {
  return (
    <div className="min-w-0 text-center">
      <p className={TIME_LABEL}>
        <span>{label}</span>
        <span className="tabular-nums normal-case font-normal">{formatTime(at)}</span>
      </p>
      <p className={`${TIME_COUNT} ${color}`}>
        <Countdown targetMs={at} />
      </p>
    </div>
  );
}

/** The small capitals over and under the count, the same both places. */
const LABEL = "text-lg font-bold uppercase tracking-widest text-secondary-600";

/**
 * Where our match is, filling its box: the matches until we're called on three lines, or once we
 * have been, Nexus's status on two.
 */
/** A count on three lines: the tallest thing the status box shows. */
function CountLines({
  above,
  count,
  below,
  accent,
}: { above: string; count: number; below: string; accent: string }) {
  return (
    <>
      <p className={LABEL}>{above}</p>
      <p className={`text-8xl font-black leading-[0.8] tabular-nums sm:text-9xl ${accent}`}>
        {count}
      </p>
      <p className={LABEL}>{below}</p>
    </>
  );
}

function Headline({ next, accent }: { next: OurNextMatch; accent: string }) {
  if (next.matchesUntilQueuing !== null || next.status === null) {
    // Before the call (or no calls at all, on The Blue Alliance's schedule): the count is what
    // the pit reads from across the room.
    const queuing = next.matchesUntilQueuing !== null;
    const count = next.matchesUntilQueuing ?? next.matchesUntilField;
    return (
      <CountLines
        above={queuing ? "Queuing in" : "Matches before"}
        count={count}
        below={queuing ? (count === 1 ? "match" : "matches") : "ours"}
        accent={accent}
      />
    );
  }
  return (
    <p className={`text-5xl font-black leading-none sm:text-6xl ${accent}`}>
      {next.status.split(" ").map((word) => (
        <span key={word} className="block">
          {word}
        </span>
      ))}
    </p>
  );
}

/**
 * Two boxes side by side, the same height: the match, and where it is in the urgency's color.
 * The status box is a fixed width that fits its widest message
 * ("queuing"), so the match box doesn't change size as the status does.
 */
function NextMatch({
  next,
  fromNexus,
  teamNumber,
}: { next: OurNextMatch; fromNexus: boolean; teamNumber: string }) {
  const style = URGENCY[urgencyOf(next)];
  const called = next.status !== null && next.status !== "Queuing soon";
  const onField = next.status === "On field";
  const times = [
    !called && next.queueTime
      ? { label: next.queued ? "Called" : "Queue", at: next.queueTime }
      : null,
    !onField && next.onFieldTime ? { label: "On field", at: next.onFieldTime } : null,
  ].filter((time) => time !== null);
  const note =
    !fromNexus || next.timesFrom === "tba"
      ? fromNexus
        ? "Times are from The Blue Alliance's schedule."
        : "Nexus isn't set up for this event, so times are from The Blue Alliance's schedule."
      : null;
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_17rem]">
      <AllianceBoard next={next} teamNumber={teamNumber} times={times} note={note} />
      <div
        className={`grid min-w-0 place-items-center rounded-xl border-[3px] p-4 text-center ${style.card}`}
      >
        {/* An unseen count in the same cell, so the box keeps that height in every state and
            nothing on the page moves when we're called. */}
        <div aria-hidden className="invisible col-start-1 row-start-1 flex flex-col gap-3">
          <CountLines above="Queuing in" count={0} below="matches" accent="" />
        </div>
        <div className="col-start-1 row-start-1 flex flex-col items-center justify-center gap-3">
          <Headline next={next} accent={style.accent} />
        </div>
      </div>
    </div>
  );
}

/**
 * The team's next match, or a plain line saying why there isn't one. `ourMatches` is null when
 * there's no schedule at all.
 */
export function OurNextMatchPanel({
  ourMatches,
  fromNexus,
  teamNumber,
}: { ourMatches: OurSchedule | null; fromNexus: boolean; teamNumber: string }) {
  const message = !ourMatches
    ? "No match schedule yet. An admin sets the event on Pit's Admin page."
    : ourMatches.total === 0
      ? "We aren't in any matches on the schedule yet."
      : "We have no more matches on the schedule.";
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">
        Our next match
      </h2>
      {ourMatches?.next ? (
        <NextMatch next={ourMatches.next} fromNexus={fromNexus} teamNumber={teamNumber} />
      ) : (
        <div className="rounded-xl border border-secondary-200 bg-surface p-4 sm:p-5">
          <p className="text-lg font-semibold text-secondary-700">{message}</p>
        </div>
      )}
    </div>
  );
}
