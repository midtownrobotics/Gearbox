import type { NodeState } from "./progress";

// Each state reads by its label and icon, not color alone.
export const STATE: Record<
  NodeState,
  { label: string; icon: string; className: string; dot: string; stroke: string }
> = {
  locked: {
    label: "Locked",
    icon: "🔒",
    className: "bg-secondary-100 text-secondary-500 border-secondary-300",
    dot: "bg-secondary-300",
    stroke: "stroke-secondary-300",
  },
  available: {
    label: "Available",
    icon: "○",
    className: "bg-sky-50 text-sky-800 border-sky-300",
    dot: "bg-sky-500",
    stroke: "stroke-sky-500",
  },
  "in-progress": {
    label: "In progress",
    icon: "◑",
    className: "bg-amber-50 text-amber-800 border-amber-300",
    dot: "bg-amber-500",
    stroke: "stroke-amber-500",
  },
  complete: {
    label: "Complete",
    icon: "✓",
    className: "bg-emerald-50 text-emerald-800 border-emerald-300",
    dot: "bg-emerald-500",
    stroke: "stroke-emerald-500",
  },
};

export const STATES: NodeState[] = ["locked", "available", "in-progress", "complete"];

export function StateBadge({ state }: { state: NodeState }) {
  const s = STATE[state];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${s.className}`}
    >
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

/** What the colors on a tree mean. */
export function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary-500">
      {STATES.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${STATE[state].dot}`} aria-hidden />
          {STATE[state].label}
        </li>
      ))}
    </ul>
  );
}
