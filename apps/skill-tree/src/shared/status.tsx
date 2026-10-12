import { Badge, tones } from "@g3/ui";
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
    className: tones.info,
    dot: "bg-sky-500",
    stroke: "stroke-sky-500",
  },
  "in-progress": {
    label: "In progress",
    icon: "◑",
    className: tones.warning,
    dot: "bg-amber-500",
    stroke: "stroke-amber-500",
  },
  complete: {
    label: "Complete",
    icon: "✓",
    className: tones.success,
    dot: "bg-emerald-500",
    stroke: "stroke-emerald-500",
  },
};

export const STATES: NodeState[] = ["locked", "available", "in-progress", "complete"];

export function StateBadge({ state }: { state: NodeState }) {
  const s = STATE[state];
  return (
    <Badge colors={s.className} icon={s.icon}>
      {s.label}
    </Badge>
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
