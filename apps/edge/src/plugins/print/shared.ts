import { printerAlerts } from "@g3/worker-edge/print-types";
import { api, getErrorMessage } from "../../shared/api";

export async function loadPrinters() {
  const res = await api.print.printers.$get();
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return (await res.json()).printers;
}

export type PrinterRow = Awaited<ReturnType<typeof loadPrinters>>[number];

export const button =
  "text-sm font-medium rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50";
export const primaryButton = `${button} bg-primary-500 hover:bg-primary-600 text-white`;
export const plainButton = `${button} text-secondary-600 hover:text-secondary-900 hover:bg-secondary-100`;
export const input = "border border-secondary-300 rounded-lg px-2 py-1 text-sm bg-surface";

/** Plain-English problems this printer reports (out of paper, jam, ...), errors first. */
export function alertsFor(p: PrinterRow) {
  return printerAlerts(p.stateReasons);
}

/** Green "Ready", amber "Printing", red "Needs attention", or gray "Stopped". */
export function printerStatus(p: PrinterRow) {
  if (alertsFor(p).some((a) => a.severity === "error")) {
    return { dot: "bg-primary-500", label: "Needs attention" };
  }
  if (p.state === "stopped" || !p.acceptingJobs) {
    return { dot: "bg-secondary-300", label: p.acceptingJobs ? "Stopped" : "Not accepting jobs" };
  }
  if (p.state === "processing") return { dot: "bg-amber-400", label: "Printing" };
  return { dot: "bg-emerald-500", label: "Ready" };
}

/** Message for a request that never got a response (offline, blocked, server down). */
export function networkError(err: unknown) {
  const detail = err instanceof Error ? ` (${err.message})` : "";
  return `Couldn't reach the Edge server${detail}. Check your connection and try again.`;
}
