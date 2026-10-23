import type { OurNextMatch, OurSchedule } from "@g3/worker-pit/monitor-matches";
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
    ring: "ring-red-500",
  },
  blue: {
    name: "Blue alliance",
    tint: "bg-blue-100",
    border: "border-blue-500",
    text: "text-blue-800",
    ring: "ring-blue-500",
  },
};

/** One alliance's teams by station, ours on a card of its own, ringed and bold. */
function AllianceTeams({
  side,
  teams,
  teamNumber,
  ours,
}: { side: "red" | "blue"; teams: string[]; teamNumber: string; ours: boolean }) {
  const alliance = ALLIANCE[side];
  // Our half has the frame's own tint and an invisible border, so it's the same size as theirs
  // and flows up into the match's name; theirs is a box of its own color inside the frame.
  const box = ours ? "border-transparent" : `rounded-lg ${alliance.border} ${alliance.tint}`;
  return (
    <div
      className={`flex flex-wrap items-center justify-evenly gap-0.5 border-[3px] px-1 py-1.5 sm:gap-1 sm:px-2 ${box}`}
    >
      <span className="sr-only">{alliance.name}:</span>
      {(teams.length ? teams : [""]).map((team, station) => (
        <span
          // Stations keep their place, even for a team not known yet.
          // biome-ignore lint/suspicious/noArrayIndexKey: a station is its place in the list
          key={station}
          className={`rounded-md px-1.5 py-0.5 text-base tabular-nums sm:px-2 sm:text-xl ${alliance.text} ${
            team === teamNumber
              ? `bg-surface font-black ring-[3px] ${alliance.ring}`
              : "font-semibold"
          }`}
        >
          {team || "—"}
        </span>
      ))}
    </div>
  );
}

/**
 * The match in our alliance's color: a frame with its name across the top, flowing into our half
 * below, and the other alliance's box beside it. Blue is always on the left and red on the right.
 */
function AllianceBoard({ next, teamNumber }: { next: OurNextMatch; teamNumber: string }) {
  const ours = ALLIANCE[next.alliance];
  return (
    <div className={`overflow-hidden rounded-xl border-[3px] ${ours.border} ${ours.tint}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 px-4 pt-2.5 pb-1">
        <div className="min-w-0">
          <h2 className={`text-xs font-bold uppercase tracking-widest ${ours.text}`}>
            Our next match
          </h2>
          <p className="text-3xl font-black text-secondary-900 sm:text-4xl">{next.label}</p>
        </div>
        <p className={`pb-1 text-sm font-bold ${ours.text}`}>{ours.name}</p>
      </div>
      <div className="grid grid-cols-2 gap-1.5 px-1.5 pb-1.5">
        <AllianceTeams
          side="blue"
          teams={next.blueTeams}
          teamNumber={teamNumber}
          ours={next.alliance === "blue"}
        />
        <AllianceTeams
          side="red"
          teams={next.redTeams}
          teamNumber={teamNumber}
          ours={next.alliance === "red"}
        />
      </div>
    </div>
  );
}

/** A countdown under its label and clock time, centered in its third of the row. */
function Time({ label, at, accent }: { label: string; at: number; accent: string }) {
  return (
    <div className="min-w-0 text-center">
      <p className="flex flex-wrap items-baseline justify-center gap-x-2 text-xs font-semibold uppercase tracking-wide text-secondary-600">
        <span>{label}</span>
        <span className="tabular-nums normal-case font-normal">{formatTime(at)}</span>
      </p>
      <p className={`text-2xl font-black tabular-nums @lg:text-4xl @3xl:text-5xl ${accent}`}>
        <Countdown targetMs={at} />
      </p>
    </div>
  );
}

/**
 * Where our match is, filling the card's height on the right: the matches until we're called on
 * three lines, or once we have been, Nexus's status on two.
 */
function Headline({ next, accent }: { next: OurNextMatch; accent: string }) {
  if (next.matchesUntilQueuing !== null || next.status === null) {
    // Before the call (or no calls at all, on The Blue Alliance's schedule): the count is what
    // the pit reads from across the room.
    const queuing = next.matchesUntilQueuing !== null;
    const count = next.matchesUntilQueuing ?? next.matchesUntilField;
    return (
      <>
        <p className="text-lg font-bold uppercase tracking-widest text-secondary-600">
          {queuing ? "Queuing in" : "Matches before"}
        </p>
        <p className={`text-8xl font-black leading-[0.8] tabular-nums sm:text-9xl ${accent}`}>
          {count}
        </p>
        <p className="text-2xl font-bold text-secondary-700 sm:text-3xl">
          {queuing ? (count === 1 ? "match" : "matches") : "ours"}
        </p>
      </>
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
    next.startTime ? { label: "Start", at: next.startTime } : null,
  ].filter((time) => time !== null);
  return (
    <div
      className={`grid gap-4 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-4 ${style.card}`}
    >
      <div className="min-w-0 space-y-3">
        <AllianceBoard next={next} teamNumber={teamNumber} />
        {times.length > 0 && (
          <div className="@container grid auto-cols-fr grid-flow-col gap-3">
            {times.map((time) => (
              <Time key={time.label} label={time.label} at={time.at} accent={style.accent} />
            ))}
          </div>
        )}
        {(!fromNexus || next.timesFrom === "tba") && (
          <p className="text-xs text-secondary-600">
            {fromNexus
              ? "Times are from The Blue Alliance's schedule."
              : "Nexus isn't set up for this event, so times are from The Blue Alliance's schedule."}
          </p>
        )}
      </div>
      <div className="flex min-w-48 flex-col items-center justify-center gap-3 text-center sm:px-4">
        <Headline next={next} accent={style.accent} />
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
  if (ourMatches?.next)
    return <NextMatch next={ourMatches.next} fromNexus={fromNexus} teamNumber={teamNumber} />;
  const message = !ourMatches
    ? "No match schedule yet. An admin sets the event on Pit's Admin page."
    : ourMatches.total === 0
      ? "We aren't in any matches on the schedule yet."
      : "We have no more matches on the schedule.";
  return (
    <div className="rounded-xl border border-secondary-200 bg-surface p-4 sm:p-5">
      <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">
        Our next match
      </h2>
      <p className="mt-2 text-lg font-semibold text-secondary-700">{message}</p>
    </div>
  );
}
