import { Badge, tones } from "@g3/ui";
import type { RequestStatus } from "./types";

// Each status reads by its label and icon, not color alone.
export const STATUS: Record<RequestStatus, { label: string; icon: string; className: string }> = {
  wishlist: {
    label: "Wishlist",
    icon: "☆",
    className: "bg-secondary-50 text-secondary-700 border-secondary-300",
  },
  requested: { label: "Awaiting approval", icon: "⏳", className: tones.warning },
  approved: { label: "Approved", icon: "✓", className: tones.info },
  denied: { label: "Denied", icon: "✕", className: tones.danger },
  ordered: {
    label: "Ordered",
    icon: "📦",
    className: "bg-violet-50 text-violet-800 border-violet-300",
  },
  received: { label: "Received", icon: "✓✓", className: tones.success },
  cancelled: { label: "Canceled", icon: "–", className: tones.neutral },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const s = STATUS[status];
  return (
    <Badge colors={s.className} icon={s.icon}>
      {s.label}
    </Badge>
  );
}
