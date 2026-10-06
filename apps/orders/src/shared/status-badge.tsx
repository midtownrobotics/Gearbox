import type { RequestStatus } from "./types";

// Each status reads by its label and icon, not color alone.
export const STATUS: Record<RequestStatus, { label: string; icon: string; className: string }> = {
  requested: {
    label: "Awaiting approval",
    icon: "⏳",
    className: "bg-amber-50 text-amber-800 border-amber-300",
  },
  approved: { label: "Approved", icon: "✓", className: "bg-sky-50 text-sky-800 border-sky-300" },
  denied: {
    label: "Denied",
    icon: "✕",
    className: "bg-primary-50 text-primary-700 border-primary-200",
  },
  ordered: {
    label: "Ordered",
    icon: "📦",
    className: "bg-violet-50 text-violet-800 border-violet-300",
  },
  received: {
    label: "Received",
    icon: "✓✓",
    className: "bg-emerald-50 text-emerald-800 border-emerald-300",
  },
  cancelled: {
    label: "Cancelled",
    icon: "–",
    className: "bg-secondary-100 text-secondary-600 border-secondary-300",
  },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${s.className}`}
    >
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}
