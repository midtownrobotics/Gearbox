import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { formatElapsed } from "../../shared/battery-display";

/** How often the Monitor asks Pit whether it can still reach it. */
const CHECK_MS = 1_000;
/** A check that hasn't answered by then counts as failed. */
const TIMEOUT_MS = 2_500;
/** Failed checks in a row before the Monitor says it's offline, so one slow answer doesn't flash it. */
const FAILURES_BEFORE_OFFLINE = 2;

export type Connection = {
  online: boolean;
  /** When Pit last answered, or null before it ever has. */
  lastOkAt: number | null;
};

async function check(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const res = await api.health.$get(undefined, {
      init: { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Asks Pit's `/health` every second while the page is showing. */
export function useConnection(): Connection {
  const [state, setState] = useState<Connection>({ online: true, lastOkAt: null });

  useEffect(() => {
    let failures = 0;
    let inFlight = false;
    let stopped = false;
    const run = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      const ok = await check();
      inFlight = false;
      if (stopped) return;
      failures = ok ? 0 : failures + 1;
      setState((s) => ({
        online: ok || (s.online && failures < FAILURES_BEFORE_OFFLINE),
        lastOkAt: ok ? Date.now() : s.lastOkAt,
      }));
    };
    void run();
    const interval = setInterval(() => void run(), CHECK_MS);
    const now = () => void run();
    window.addEventListener("online", now);
    window.addEventListener("offline", now);
    document.addEventListener("visibilitychange", now);
    return () => {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener("online", now);
      window.removeEventListener("offline", now);
      document.removeEventListener("visibilitychange", now);
    };
  }, []);

  return state;
}

/** Re-renders every second, so "how long ago" counts up. */
function useTick() {
  const [, setNow] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), CHECK_MS);
    return () => clearInterval(interval);
  }, []);
}

/** The header's dot: green and the time Pit last answered, red when it can't be reached. */
export function ConnectionIndicator({ connection }: { connection: Connection }) {
  useTick();
  const { online, lastOkAt } = connection;
  return (
    <p
      role="status"
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${
        online
          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
          : "border-red-300 bg-red-50 text-red-700"
      }`}
    >
      <span className="relative flex size-2.5">
        {online && (
          <span
            key={lastOkAt}
            className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75 [animation-iteration-count:1]"
          />
        )}
        <span
          className={`relative inline-flex size-2.5 rounded-full ${online ? "bg-emerald-500" : "bg-red-600"}`}
        />
      </span>
      {online ? "Online" : "Offline"}
      {lastOkAt && (
        <span className="font-normal tabular-nums">{new Date(lastOkAt).toLocaleTimeString()}</span>
      )}
    </p>
  );
}

/** Covers the Monitor while Pit can't be reached, so nobody trusts what it shows. */
export function OfflineOverlay({ connection }: { connection: Connection }) {
  useTick();
  if (connection.online) return null;
  const { lastOkAt } = connection;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="monitor-offline-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-secondary-900/60 p-6"
    >
      <div className="w-full max-w-2xl rounded-2xl border-4 border-red-600 bg-surface p-10 text-center shadow-2xl">
        <p className="mx-auto mb-6 size-6 animate-pulse rounded-full bg-red-600" />
        <h2 id="monitor-offline-title" className="text-6xl font-black text-red-700">
          Offline
        </h2>
        <p className="mt-4 text-xl text-secondary-700">
          {lastOkAt
            ? `Last connected ${new Date(lastOkAt).toLocaleTimeString()} (${formatElapsed(lastOkAt)} ago). What's shown may be out of date.`
            : "Pit can't be reached. What's shown may be out of date."}
        </p>
        <p className="mt-2 text-secondary-500">Reconnecting…</p>
      </div>
    </div>
  );
}
