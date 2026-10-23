import { Badge, tones } from "@g3/ui";
import type { OurNextMatch, OurSchedule } from "@g3/worker-pit/monitor-matches";
import { Countdown, formatTime } from "./match-time";

// The Monitor's "Our next match": where the team's next match is, how many matches until it's
// called to queue (then until it's on the field), and the countdowns. Its colors say how close it
// is: calm while it's far off, then green, amber and red as it nears the field.

type Urgency = "later" | "soon" | "queuing" | "deck" | "field";

const URGENCY: Record<Urgency, { card: string; accent: string; badge: string }> = {
  later: {
    card: "border-secondary-200 bg-surface",
    accent: "text-secondary-900",
    badge: tones.neutral,
  },
  soon: {
    card: "border-emerald-300 bg-emerald-50",
    accent: "text-emerald-700",
    badge: tones.success,
  },
  queuing: {
    card: "border-amber-400 bg-amber-50 ring-2 ring-amber-300",
    accent: "text-amber-700",
    badge: tones.warning,
  },
  deck: {
    card: "border-red-400 bg-red-50 ring-2 ring-red-300",
    accent: "text-red-700",
    badge: tones.danger,
  },
  field: {
    card: "border-red-500 bg-red-50 ring-4 ring-red-500",
    accent: "text-red-700",
    badge: "bg-red-600 text-white border-red-700",
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

const matches = (count: number) => `${count} ${count === 1 ? "match" : "matches"}`;

const ALLIANCE = {
  red: { name: "Red alliance", fill: "bg-red-600 text-white", team: "bg-red-100 text-red-700" },
  blue: {
    name: "Blue alliance",
    fill: "bg-blue-600 text-white",
    team: "bg-blue-100 text-blue-700",
  },
};

function Teams({ label, teams, color }: { label: string; teams: string[]; color: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-secondary-600">
        {label}
      </span>
      {teams.length === 0 ? (
        <span className="text-secondary-500">—</span>
      ) : (
        teams.map((team) => (
          <span key={team} className={`rounded px-2 py-0.5 font-bold tabular-nums ${color}`}>
            {team}
          </span>
        ))
      )}
    </div>
  );
}

/** A countdown with its clock time under it. */
function Time({ label, at, accent }: { label: string; at: number; accent: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-secondary-600">{label}</p>
      <p className={`text-xl font-black tabular-nums sm:text-3xl ${accent}`}>
        <Countdown targetMs={at} />
      </p>
      <p className="text-xs tabular-nums text-secondary-600">{formatTime(at)}</p>
    </div>
  );
}

/** The big line: matches until we're called, or where we are once we have been. */
function Headline({ next, accent }: { next: OurNextMatch; accent: string }) {
  const big = `font-black leading-none tabular-nums ${accent}`;
  if (next.matchesUntilQueuing !== null || next.status === null) {
    // Before the call (or no calls at all, on The Blue Alliance's schedule): the count is what
    // the pit reads from across the room.
    const count = next.matchesUntilQueuing ?? next.matchesUntilField;
    return (
      <div>
        <p className="text-sm font-bold uppercase tracking-widest text-secondary-600">
          {next.matchesUntilQueuing !== null ? "Queuing in" : "Matches before ours"}
        </p>
        <p className="mt-1 flex items-baseline gap-3">
          <span className={`text-7xl sm:text-8xl ${big}`}>{count}</span>
          {next.matchesUntilQueuing !== null && (
            <span className="text-2xl font-bold text-secondary-700">
              {count === 1 ? "match" : "matches"}
            </span>
          )}
        </p>
      </div>
    );
  }
  const toField = next.matchesUntilField;
  return (
    <div>
      <p className={`text-5xl sm:text-6xl ${big}`}>{next.status}</p>
      <p className="mt-2 text-xl font-bold text-secondary-700">
        {toField === 0
          ? "Playing now"
          : toField === 1
            ? "On field next"
            : `On field in ${matches(toField)}`}
      </p>
    </div>
  );
}

function NextMatch({ next, fromNexus }: { next: OurNextMatch; fromNexus: boolean }) {
  const style = URGENCY[urgencyOf(next)];
  const ours = ALLIANCE[next.alliance];
  const theirs = ALLIANCE[next.alliance === "red" ? "blue" : "red"];
  const called = next.status !== null && next.status !== "Queuing soon";
  const onField = next.status === "On field";
  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${style.card}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-600">
          Our next match
        </h2>
        {next.status && <Badge colors={style.badge}>{next.status}</Badge>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-3xl font-black text-secondary-900 sm:text-4xl">{next.label}</p>
        <span className={`rounded-md px-2.5 py-1 text-sm font-bold ${ours.fill}`}>{ours.name}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        <Teams label="With" teams={next.partners} color={ours.team} />
        <Teams label="Against" teams={next.opponents} color={theirs.team} />
      </div>

      <div className="mt-4 grid gap-4 border-t border-secondary-200 pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end lg:grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto]">
        <Headline next={next} accent={style.accent} />
        <div className="grid grid-cols-3 gap-3 sm:flex sm:gap-6 lg:grid xl:flex">
          {!called && next.queueTime && (
            <Time
              label={next.queued ? "Called" : "Queue"}
              at={next.queueTime}
              accent={style.accent}
            />
          )}
          {!onField && next.onFieldTime && (
            <Time label="On field" at={next.onFieldTime} accent={style.accent} />
          )}
          {next.startTime && <Time label="Start" at={next.startTime} accent={style.accent} />}
        </div>
      </div>
      {(!fromNexus || next.timesFrom === "tba") && (
        <p className="mt-3 text-xs text-secondary-600">
          {fromNexus
            ? "Times are from The Blue Alliance's schedule."
            : "Nexus isn't set up for this event, so times are from The Blue Alliance's schedule."}
        </p>
      )}
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
}: { ourMatches: OurSchedule | null; fromNexus: boolean }) {
  if (ourMatches?.next) return <NextMatch next={ourMatches.next} fromNexus={fromNexus} />;
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
