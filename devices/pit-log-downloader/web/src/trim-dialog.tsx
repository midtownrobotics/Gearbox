import { Button, Dialog, ErrorBanner, Loading } from "@g3/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LogStatus, TrimView } from "../../src/status.ts";

// Trimming a log for Gearbox: a chart of its data over time, with the robot's enabled and
// autonomous time shaded, two sliders for what to keep, and a suggested trim around the match.
// The file on this computer isn't cut; only what's uploaded is.

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function Chart({ view, from, to }: { view: TrimView; from: number; to: number }) {
  const width = Math.max(1, view.bytesPerSecond.length);
  const most = Math.max(1, ...view.bytesPerSecond);
  return (
    <svg
      viewBox={`0 0 ${width} 100`}
      preserveAspectRatio="none"
      className="h-32 w-full rounded-lg bg-inset"
      role="img"
      aria-label="The log's data over time, with the enabled time shaded"
    >
      {view.enabled.map(([a, b]) => (
        <rect key={`e${a}`} x={a} width={b - a} y={0} height={100} className="fill-primary-100" />
      ))}
      {view.autonomous.map(([a, b]) => (
        <rect key={`a${a}`} x={a} width={b - a} y={0} height={100} className="fill-primary-200" />
      ))}
      {view.bytesPerSecond.map((bytes, second) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: one bar per second, in order
          key={second}
          x={second}
          width={1}
          y={100 - (bytes / most) * 96}
          height={(bytes / most) * 96}
          className="fill-secondary-500"
        />
      ))}
      {/* What isn't kept, dimmed. */}
      <rect x={0} width={from} y={0} height={100} className="fill-page" opacity={0.75} />
      <rect
        x={to}
        width={Math.max(0, width - to)}
        y={0}
        height={100}
        className="fill-page"
        opacity={0.75}
      />
    </svg>
  );
}

export function TrimDialog({ log, onClose }: { log: LogStatus; onClose: () => void }) {
  const [view, setView] = useState<TrimView | null>(null);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/logs/${encodeURIComponent(log.id)}/trim`;

  const show = useCallback((next: TrimView) => {
    setView(next);
    const [a, b] = next.trim ?? [0, next.duration];
    setFrom(Math.floor(a));
    setTo(Math.ceil(b));
  }, []);

  useEffect(() => {
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(show)
      .catch(() => setError("Couldn't read the log."));
  }, [url, show]);

  // About what the kept part comes to gzipped, from how well the log compresses so far.
  const estimate = useMemo(() => {
    if (!view) return 0;
    const bytesIn = (a: number, b: number) =>
      view.bytesPerSecond.slice(Math.floor(a), Math.ceil(b)).reduce((sum, n) => sum + n, 0);
    const [ka, kb] = view.trim ?? [0, view.duration];
    const ratio = view.uploadSize ? view.uploadSize / Math.max(1, bytesIn(ka, kb)) : 0.4;
    return bytesIn(from, to) * ratio;
  }, [view, from, to]);

  async function save(range: [number, number] | null) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(range ? { from: range[0], to: range[1] } : { from: null }),
      });
      const next = (await res.json()) as TrimView & { error?: string };
      if (!res.ok) throw new Error(next.error);
      show(next);
      if (next.uploadSize !== null && next.uploadSize > next.maxUploadSize) {
        setError(
          `That comes to ${mb(next.uploadSize)}: keep less to get under ${mb(next.maxUploadSize)}.`,
        );
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't trim the log.");
    } finally {
      setBusy(false);
    }
  }

  const over = view ? estimate > view.maxUploadSize : false;
  return (
    <Dialog title={`Trim ${log.name}`} onClose={onClose} size="2xl">
      {!view ? (
        error ? (
          <ErrorBanner message={error} />
        ) : (
          <Loading />
        )
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-secondary-600">
            Choose the part of the log to upload. Shaded is when the robot was enabled (darker:
            autonomous). The whole log stays on this computer.
          </p>
          {error && <ErrorBanner message={error} />}
          <Chart view={view} from={from} to={to} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-secondary-700">
              Start: {clock(from)}
              <input
                type="range"
                className="w-full"
                min={0}
                max={Math.ceil(view.duration)}
                value={from}
                onChange={(e) => setFrom(Math.min(Number(e.target.value), to - 1))}
              />
            </label>
            <label className="text-sm text-secondary-700">
              End: {clock(to)}
              <input
                type="range"
                className="w-full"
                min={0}
                max={Math.ceil(view.duration)}
                value={to}
                onChange={(e) => setTo(Math.max(Number(e.target.value), from + 1))}
              />
            </label>
          </div>
          <p className={`text-sm ${over ? "text-red-700" : "text-secondary-600"}`}>
            About {mb(estimate)} to upload, of {clock(to - from)}; Gearbox takes up to{" "}
            {mb(view.maxUploadSize)}.
          </p>
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={!view.suggested}
                title={view.suggested ? undefined : "The robot was never enabled in this log."}
                onClick={() => {
                  if (!view.suggested) return;
                  setFrom(Math.floor(view.suggested[0]));
                  setTo(Math.ceil(view.suggested[1]));
                }}
              >
                Suggested trim
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setFrom(0);
                  setTo(Math.ceil(view.duration));
                }}
              >
                Keep all
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  save(from <= 0 && to >= Math.ceil(view.duration) ? null : [from, to])
                }
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
