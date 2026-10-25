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

/** A built-in field or robot a team at an FRC event may show: not FTC's, and not a joystick. */
function frcAsset(name: string, config: unknown) {
  if (!/^(Field2d|Field3d|Robot)_/.test(name) || name.includes("FTC")) return false;
  return !(config && typeof config === "object" && "isFTC" in config && config.isFTC === true);
}

/** Every file of an asset index but config.json, at its address, as AdvantageScope asks for it. */
function assetFiles(index: Record<string, unknown>, base: string, keep: typeof frcAsset) {
  return Object.keys(index).flatMap((path) => {
    const [name, file] = path.split("/");
    if (!name || !file || file === "config.json") return [];
    if (!keep(name, index[`${name}/config.json`])) return [];
    return [`${base}${encodeURIComponent(name)}/${file}`];
  });
}

const readIndex = async (url: string) => {
  const res = await fetch(url, { credentials: "same-origin" });
  return res.ok ? ((await res.json()) as Record<string, unknown>) : {};
};

/**
 * Saves AdvantageScope on this device, so it opens offline: its own files, the team's uploaded
 * fields and robots, and the built-in FRC ones. Each goes through Pit's service worker, which
 * keeps it (public/scope-cache.js); one it has already is checked, not downloaded again.
 */
export async function saveAdvantageScope(progress: (done: number, of: number) => void) {
  const appFiles = (await (await fetch("/scope/files.json")).json()) as string[];
  const urls = [
    "/scope/",
    ...appFiles.map((file) => `/scope/${encodeURI(file)}`),
    "/api/scope/settings",
    "/api/scope/logs",
    ...assetFiles(await readIndex("/api/scope/assets"), "/api/scope/assets/", () => true),
    ...assetFiles(
      await readIndex("/scope/bundledAssets/index.json"),
      "/scope/bundledAssets/",
      frcAsset,
    ),
  ];
  for (const [done, url] of urls.entries()) {
    progress(done, urls.length);
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`Couldn't save ${url} (${res.status})`);
    await res.arrayBuffer();
  }
}
