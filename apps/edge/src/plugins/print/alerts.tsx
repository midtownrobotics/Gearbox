import type { PrinterAlert } from "@g3/worker-edge/print-types";

/** A printer's problems in plain English: errors in red, warnings in amber. */
export function PrinterAlerts({
  alerts,
  className = "",
}: { alerts: PrinterAlert[]; className?: string }) {
  if (alerts.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {alerts.map((a) => (
        <li
          key={a.message}
          className={`text-sm font-medium rounded-lg px-2.5 py-1 border ${
            a.severity === "error"
              ? "text-red-800 bg-red-50 border-red-200"
              : "text-amber-800 bg-amber-50 border-amber-200"
          }`}
        >
          {a.message}
        </li>
      ))}
    </ul>
  );
}
