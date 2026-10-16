import { Badge, tones } from "@g3/ui";
import type { Priority } from "./types";

export const PRIORITY: Record<Priority, { label: string; hint: string; className: string }> = {
  blocking: {
    label: "Blocking",
    hint: "Stops the build or the robot",
    className: tones.danger,
  },
  high: {
    label: "High",
    hint: "Needed this week",
    className: tones.warning,
  },
  normal: {
    label: "Normal",
    hint: "",
    className: "bg-secondary-50 text-secondary-600 border-secondary-200",
  },
  nice: {
    label: "Nice to have",
    hint: "",
    className: "bg-surface text-secondary-500 border-secondary-200",
  },
};

export const PRIORITY_ORDER: Priority[] = ["blocking", "high", "normal", "nice"];

/** Shown for anything but Normal, so the list stays quiet. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === "normal") return null;
  const p = PRIORITY[priority];
  return (
    <Badge colors={p.className} icon={priority === "blocking" ? "⛔" : undefined}>
      {p.label}
    </Badge>
  );
}
