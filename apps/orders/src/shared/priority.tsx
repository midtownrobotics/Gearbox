import type { Priority } from "./types";

export const PRIORITY: Record<Priority, { label: string; hint: string; className: string }> = {
  blocking: {
    label: "Blocking",
    hint: "Stops the build or the robot",
    className: "bg-primary-50 text-primary-700 border-primary-300",
  },
  high: {
    label: "High",
    hint: "Needed this week",
    className: "bg-amber-50 text-amber-800 border-amber-300",
  },
  normal: {
    label: "Normal",
    hint: "",
    className: "bg-secondary-50 text-secondary-600 border-secondary-200",
  },
  nice: {
    label: "Nice to have",
    hint: "",
    className: "bg-white text-secondary-500 border-secondary-200",
  },
};

export const PRIORITY_ORDER: Priority[] = ["blocking", "high", "normal", "nice"];

/** Shown for anything but Normal, so the list stays quiet. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === "normal") return null;
  const p = PRIORITY[priority];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${p.className}`}
    >
      {priority === "blocking" && <span aria-hidden>⛔</span>}
      {p.label}
    </span>
  );
}
