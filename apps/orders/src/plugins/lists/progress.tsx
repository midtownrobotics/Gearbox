import type { ListProgress } from "../../shared/types";

// Where a list's parts are, furthest along first. Denied and cancelled requests are left out:
// they aren't coming, so they don't count toward "how much of the list is here".
export const STAGES = [
  { status: "received", label: "Arrived", bar: "bg-emerald-500", dot: "bg-emerald-500" },
  { status: "ordered", label: "Ordered", bar: "bg-violet-500", dot: "bg-violet-500" },
  { status: "approved", label: "Approved", bar: "bg-sky-500", dot: "bg-sky-500" },
  { status: "requested", label: "Awaiting approval", bar: "bg-amber-400", dot: "bg-amber-400" },
] as const;

/** A bar split by stage, with a text summary so it doesn't rely on color. */
export function ProgressBar({ progress }: { progress: ListProgress }) {
  const { active } = progress;
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary-100"
      role="img"
      aria-label={summary(progress)}
    >
      {active > 0 &&
        STAGES.map((s) =>
          progress[s.status] > 0 ? (
            <div
              key={s.status}
              className={s.bar}
              style={{ width: `${(progress[s.status] / active) * 100}%` }}
            />
          ) : null,
        )}
    </div>
  );
}

/** "3 of 10 arrived · 2 ordered · 1 approved · 4 awaiting approval" */
export function summary(p: ListProgress): string {
  if (p.total === 0) return "No parts yet";
  if (p.active === 0) return "Nothing coming (all denied or cancelled)";
  const rest = STAGES.slice(1)
    .filter((s) => p[s.status] > 0)
    .map((s) => `${p[s.status]} ${s.label.toLowerCase()}`);
  return [`${p.received} of ${p.active} arrived`, ...rest].join(" · ");
}

/** One count per stage, each with its color dot. */
export function StageCounts({ progress }: { progress: ListProgress }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-secondary-700">
      {STAGES.map((s) => (
        <span key={s.status} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} aria-hidden />
          <span className="font-semibold tabular-nums">{progress[s.status]}</span> {s.label}
        </span>
      ))}
    </div>
  );
}
