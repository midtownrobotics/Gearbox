import { Button, ErrorBanner } from "@g3/ui";
import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";

// The event snapshot's clock, for admins on the Monitor (dev and staging only, while the snapshot
// is on): moves it on or back, so each state of "Our next match" can be seen without waiting.

type Move = { minutes: number } | { matches: 1 | -1 } | { reset: true };

const MOVES: { label: string; move: Move }[] = [
  { label: "−1 match", move: { matches: -1 } },
  { label: "−5 min", move: { minutes: -5 } },
  { label: "−1 min", move: { minutes: -1 } },
  { label: "+1 min", move: { minutes: 1 } },
  { label: "+5 min", move: { minutes: 5 } },
  { label: "+1 match", move: { matches: 1 } },
];

/** "+1:02:05" or "−9:30": hours only when there are some. */
function formatClock(ms: number): string {
  const sign = ms < 0 ? "−" : "+";
  const total = Math.floor(Math.abs(ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = (total % 60).toString().padStart(2, "0");
  return hours > 0
    ? `${sign}${hours}:${minutes.toString().padStart(2, "0")}:${seconds}`
    : `${sign}${minutes}:${seconds}`;
}

/**
 * `clockMs` is the clock when the Monitor's data was loaded; it runs on from there. `onMoved`
 * loads the Monitor again.
 */
export function SnapshotClock({ clockMs, onMoved }: { clockMs: number; onMoved: () => void }) {
  const [base, setBase] = useState({ clockMs, at: Date.now() });
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setBase({ clockMs, at: Date.now() }), [clockMs]);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  async function move(body: Move) {
    setBusy(true);
    const res = await api.admin["event-snapshot"].clock.$put({ json: body }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(res ? await getErrorMessage(res as unknown as Response) : "No connection.");
      return;
    }
    const { clockMs: moved } = (await res.json()) as { clockMs: number };
    setError(null);
    setBase({ clockMs: moved, at: Date.now() });
    onMoved();
  }

  return (
    <div className="space-y-2 rounded-xl border border-secondary-200 bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-secondary-700">
          <span className="font-mono font-bold tabular-nums text-secondary-900">
            {formatClock(base.clockMs + (now - base.at))}
          </span>{" "}
          since the snapshot was taken
        </p>
        <div className="flex flex-wrap gap-2">
          {MOVES.map(({ label, move: body }) => (
            <Button
              key={label}
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void move(body)}
            >
              {label}
            </Button>
          ))}
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void move({ reset: true })}
          >
            Reset
          </Button>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
    </div>
  );
}
