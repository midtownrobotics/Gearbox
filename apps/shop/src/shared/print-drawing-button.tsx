import { useAppOn } from "@g3/ui";
import { useEffect, useState } from "react";
import { api } from "./api";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  /** Queued, but the printer has a problem (out of paper, jam, ...). */
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

/**
 * Prints a part revision's drawing on the shop printer (one-sided, black and
 * white). The shop worker sends the PDF from storage straight to the edge
 * box, so nothing is downloaded to this device. Not shown while the team has
 * Edge switched off.
 */
export function PrintDrawingButton({
  partNumber,
  revision,
  size = "small",
}: {
  partNumber: string;
  revision: string;
  /** "kiosk": full-width touch button; "small": inline link-sized button. */
  size?: "kiosk" | "small";
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Let "Sent" fade back to the normal label so it can be pressed again; leave
  // a printer warning up longer so it gets read.
  useEffect(() => {
    if (status.kind !== "sent" && status.kind !== "warning") return;
    const t = setTimeout(() => setStatus({ kind: "idle" }), status.kind === "sent" ? 4000 : 15000);
    return () => clearTimeout(t);
  }, [status]);

  const edgeOn = useAppOn("edge");
  if (edgeOn === false) return null;

  async function print() {
    setStatus({ kind: "sending" });
    try {
      const res = await api.print.drawing[":partNumber"][":revision"].$post({
        param: { partNumber, revision },
      });
      const data = (await res.json()) as { ok: boolean; error?: string; warning?: string | null };
      if (!data.ok) setStatus({ kind: "error", message: data.error ?? "Print failed." });
      else if (data.warning) setStatus({ kind: "warning", message: data.warning });
      else setStatus({ kind: "sent" });
    } catch {
      setStatus({ kind: "error", message: "Couldn't reach the print service." });
    }
  }

  const label = {
    idle: "Print Drawing",
    sending: "Sending…",
    sent: "Sent to printer ✓",
    warning: "Sent, printer needs attention",
    error: "Print Drawing",
  }[status.kind];
  const message = status.kind === "warning" || status.kind === "error" ? status.message : null;

  if (size === "kiosk") {
    const look = {
      sent: "text-emerald-700 bg-emerald-50 border-emerald-200",
      warning: "text-amber-800 bg-amber-50 border-amber-300",
    }[status.kind as "sent" | "warning"];
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={print}
          disabled={status.kind === "sending"}
          className={`w-full flex-1 px-3 py-3 text-sm sm:text-base lg:px-6 lg:py-4 lg:text-lg font-semibold rounded-lg border transition-colors disabled:opacity-50 ${
            look ??
            "text-steel-dark bg-steel-tint border-steel/30 hover:bg-steel/20 hover:border-steel/50 active:bg-steel/30"
          }`}
        >
          {label}
        </button>
        {message && (
          <p
            className={`text-sm ${status.kind === "warning" ? "text-amber-800" : "text-crimson-dark"}`}
          >
            {message}
          </p>
        )}
      </div>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={print}
        disabled={status.kind === "sending"}
        className={`text-xs font-medium underline disabled:opacity-50 ${
          status.kind === "sent"
            ? "text-emerald-700"
            : status.kind === "warning"
              ? "text-amber-800"
              : "text-crimson hover:text-crimson-dark"
        }`}
      >
        {label}
      </button>
      {message && (
        <span
          className={`text-xs ${status.kind === "warning" ? "text-amber-800" : "text-crimson-dark"}`}
        >
          {message}
        </span>
      )}
    </span>
  );
}
