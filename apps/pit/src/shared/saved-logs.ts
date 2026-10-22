import { useEffect, useState } from "react";
import { scopeLogFile } from "./getters/advantagescope";
import type { MatchLog } from "./getters/downloaders";

// The match logs kept on this device: Pit's service worker keeps each log AdvantageScope opens
// (public/scope-cache.js), by its address and with its ETag, `"log-<id>"`, and the Logs page
// saves the rest ahead.

const LOG_CACHE = "scope-logs";
const LOG_PATH = "/api/scope/logs/";

const savedPath = (log: MatchLog) => LOG_PATH + encodeURIComponent(scopeLogFile(log));

/**
 * The ids of `logs` kept on this device, again whenever the service worker keeps one. Logs Pit no
 * longer has (deleted, or uploaded again) are let go from the device.
 */
export function useSavedLogs(logs: MatchLog[] | null) {
  const [saved, setSaved] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!logs || typeof caches === "undefined") return;
    let stale = false;
    const read = async () => {
      const cache = await caches.open(LOG_CACHE);
      const current = new Map(logs.map((log) => [savedPath(log), `"log-${log.id}"`]));
      const ids = new Set<number>();
      for (const request of await cache.keys()) {
        const path = new URL(request.url).pathname;
        const etag = (await cache.match(request))?.headers.get("ETag");
        const log = logs.find((log) => savedPath(log) === path);
        if (log && etag === current.get(path)) ids.add(log.id);
        else await cache.delete(request);
      }
      if (!stale) setSaved(ids);
    };
    const update = () => void read().catch(() => {});
    update();
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "scope-log-saved") update();
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      stale = true;
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [logs]);
  return saved;
}

/** Whether this page can save logs: Pit's service worker is running it (not on a first visit). */
export const canSaveLogs = () =>
  typeof caches !== "undefined" && Boolean(navigator.serviceWorker?.controller);

/** Saves a log on this device for AdvantageScope, without opening it. */
export async function saveLog(log: MatchLog) {
  const res = await fetch(savedPath(log), {
    credentials: "same-origin",
    headers: { "X-Gearbox-Save": "1" },
  });
  if (res.status !== 204) throw new Error(`Couldn't save the log (${res.status})`);
}
