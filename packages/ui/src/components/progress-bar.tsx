/** A thin bar filled to `percent`. Decoration: show the number beside it. */
export function ProgressBar({ percent, className = "" }: { percent: number; className?: string }) {
  return (
    <div
      className={`h-1.5 rounded-full bg-secondary-200 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <div className="h-full rounded-full bg-primary-500" style={{ width: `${percent}%` }} />
    </div>
  );
}
