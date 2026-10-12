/**
 * A thin bar filled to `percent`, green once `done`. Decoration: show the number beside it.
 */
export function ProgressBar({
  percent,
  done = false,
  className = "",
}: { percent: number; done?: boolean; className?: string }) {
  return (
    <div
      className={`h-1.5 rounded-full bg-secondary-200 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <div
        className={`h-full rounded-full ${done ? "bg-emerald-500" : "bg-primary-500"}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
