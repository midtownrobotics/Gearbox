// Imported into Pit's service worker (vite.config.ts, workbox.importScripts). Keeps AdvantageScope's
// field and robot models and images on the device, so each is downloaded once, not on every load:
// the browser's own cache drops files this big. A file is kept with its version from its asset
// index (the built-in assets' and the team's uploads'), and downloaded again only when the index
// gives another version. Without a connection, the copy kept is used whatever its version.
//
// Match logs too, each one once opened: kept gzipped, as Pit stores them, and unzipped as
// AdvantageScope reads one. A kept log is checked with Pit first (its ETag: an answer of a few
// bytes), and used as it is when Pit doesn't answer in a few seconds. Pit's AdvantageScope page
// reads this cache to show which logs are on the device, and lets go of logs Pit no longer has.
// Its Logs page saves logs ahead (X-Gearbox-Save): kept, and answered 204 with no body.
//
// And AdvantageScope itself (its page, scripts and WebAssembly under /scope/), with the team's
// settings and the list of logs it starts from: from the network while there is one, a copy
// kept each time, which is used without a connection. So it opens offline once it has been
// opened online.

const SCOPE_CACHE = "scope-assets";
const VERSION = "X-Gearbox-Version";
/** Each asset index, and where its files are. */
const INDEXES = [
  { index: "/scope/bundledAssets/index.json", files: "/scope/bundledAssets/" },
  { index: "/api/scope/assets", files: "/api/scope/assets/" },
];
const LOG_CACHE = "scope-logs";
const LOG_FILES = "/api/scope/logs/";
/** How long a kept log waits for Pit to say it's still the log, before it's used anyway. */
const LOG_CHECK_MS = 4000;
const APP_CACHE = "scope-app";
/** Pit's answers AdvantageScope starts from, kept for offline like its own files. */
const APP_ANSWERS = ["/api/scope/settings", "/api/scope/logs"];
const isApp = (path) =>
  APP_ANSWERS.includes(path) ||
  path === "/scope" ||
  (path.startsWith("/scope/") && !path.startsWith("/scope/bundledAssets/"));
/** Each index as last read, by its path. */
const versions = new Map();

/** The asset index from the network (saved for offline), and the files it no longer lists let go. */
async function readIndex(event, entry) {
  const cache = await caches.open(SCOPE_CACHE);
  let response;
  try {
    response = await fetch(event.request);
  } catch (err) {
    const saved = await cache.match(entry.index);
    if (saved) return saved;
    throw err;
  }
  if (!response.ok) return response;
  const index = await response
    .clone()
    .json()
    .catch(() => null);
  if (!index || typeof index !== "object") return response;
  versions.set(entry.index, index);
  event.waitUntil(
    (async () => {
      await cache.put(entry.index, response.clone());
      for (const request of await cache.keys()) {
        const path = new URL(request.url).pathname;
        if (path === entry.index || !path.startsWith(entry.files)) continue;
        const saved = await cache.match(request);
        if (saved?.headers.get(VERSION) !== index[fileKey(entry, path)]) {
          await cache.delete(request);
        }
      }
    })(),
  );
  return response;
}

/** "Robot_Comet/model.glb" for /api/scope/assets/Robot_Comet/model.glb. */
const fileKey = (entry, path) => decodeURIComponent(path.slice(entry.files.length));

/** A file: the copy kept when it's the index's version, else downloaded and kept. */
async function readFile(event, entry) {
  const cache = await caches.open(SCOPE_CACHE);
  const path = new URL(event.request.url).pathname;
  const saved = await cache.match(path);
  let index = versions.get(entry.index);
  if (!index) {
    index = await (await cache.match(entry.index))?.json().catch(() => null);
    if (index) versions.set(entry.index, index);
  }
  const version = index?.[fileKey(entry, path)];
  if (saved && typeof version === "string" && saved.headers.get(VERSION) === version) return saved;

  let response;
  try {
    response = await fetch(event.request);
  } catch (err) {
    if (saved) return saved;
    throw err;
  }
  if (response.status !== 200 || typeof version !== "string") return response;
  // The body as downloaded is already unzipped, so its encoding and length go.
  const headers = new Headers(response.headers);
  headers.set(VERSION, version);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  const kept = new Response(response.clone().body, { status: 200, headers });
  event.waitUntil(cache.put(path, kept).catch(() => {}));
  return response;
}

/** A kept log as AdvantageScope reads it: the .wpilog, unzipped. */
const unzipped = (gzipped) =>
  new Response(gzipped.body.pipeThrough(new DecompressionStream("gzip")), {
    headers: { "Content-Type": "application/octet-stream" },
  });

/** A match log: the copy kept while Pit says it's still the log (or doesn't answer), else downloaded and kept. */
async function readLog(event) {
  const saving = event.request.headers.has("X-Gearbox-Save");
  const cache = await caches.open(LOG_CACHE);
  const path = new URL(event.request.url).pathname;
  const saved = await cache.match(path);
  const etag = saved?.headers.get("ETag");
  const abort = new AbortController();
  const timer = etag && !saving ? setTimeout(() => abort.abort(), LOG_CHECK_MS) : null;
  let response;
  try {
    response = await fetch(event.request.url, {
      credentials: "same-origin",
      headers: { "X-Gearbox-Raw": "gzip", ...(etag ? { "If-None-Match": etag } : {}) },
      signal: abort.signal,
    });
  } catch (err) {
    if (saved && !saving) return unzipped(saved);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (response.status === 304 && saved)
    return saving ? new Response(null, { status: 204 }) : unzipped(saved);
  if (response.status === 404) event.waitUntil(cache.delete(path));
  // As stored: gzipped (a Pit from before sends it unzipped, which isn't kept).
  if (response.status !== 200 || response.headers.get("Content-Type") !== "application/gzip") {
    return response;
  }
  const headers = { "Content-Type": "application/gzip", ETag: response.headers.get("ETag") ?? "" };
  const keep = async (body) => {
    await cache.put(path, new Response(body, { headers }));
    // Pit's pages mark the log as on the device.
    for (const client of await self.clients.matchAll({ type: "window" })) {
      client.postMessage({ type: "scope-log-saved", path });
    }
  };
  if (saving) {
    await keep(response.body);
    return new Response(null, { status: 204 });
  }
  const [kept, read] = response.body.tee();
  event.waitUntil(keep(kept).catch(() => {}));
  return unzipped(new Response(read));
}

/**
 * A kept copy as an answer of its own, with no address: a page answered with one that has
 * another address (www/hub for www/hub.html) isn't run by this service worker in Firefox, so the
 * workers it starts would go to the network for their models.
 */
const asAnswer = (saved) =>
  new Response(saved.body, {
    status: saved.status,
    statusText: saved.statusText,
    headers: saved.headers,
  });

/**
 * AdvantageScope's own files: from the network, a copy kept (again only when it changed), and
 * the copy without a connection. Kept by path: the page's ?log= doesn't change it.
 */
async function readApp(event) {
  const cache = await caches.open(APP_CACHE);
  const path = new URL(event.request.url).pathname;
  let response;
  try {
    response = await fetch(event.request);
  } catch (err) {
    // A page load isn't followed through Cloudflare's redirect (www/hub.html to www/hub): the
    // browser loads www/hub itself, and that's the copy kept.
    const saved =
      (await cache.match(path)) ??
      (path.endsWith(".html") ? await cache.match(path.slice(0, -".html".length)) : undefined);
    if (saved) return asAnswer(saved);
    throw err;
  }
  if (response.status !== 200) return response;
  // Cloudflare sends www/hub.html on to www/hub, and a redirected answer can't answer a page load
  // from the cache: kept, and answered, as the page itself, at the address asked for.
  if (response.redirected) {
    response = new Response(response.body, { status: 200, headers: response.headers });
  }
  const copy = response.clone();
  event.waitUntil(
    (async () => {
      const etag = response.headers.get("ETag");
      const saved = await cache.match(path);
      if (etag && saved?.headers.get("ETag") === etag) await copy.body?.cancel();
      else await cache.put(path, copy);
    })().catch(() => {}),
  );
  return response;
}

/**
 * Answers a request, writing to the service worker's own console what asked (a page or a
 * worker) and what it got, for finding out why something doesn't open offline.
 */
function answer(event, read) {
  const { request } = event;
  const path = new URL(request.url).pathname;
  const asked = `${request.destination || "fetch"} ${path}`;
  event.respondWith(
    read(event).then(
      (response) => {
        console.debug(
          "[scope-cache]",
          asked,
          "→",
          response.status,
          response.url ? "network" : "kept",
        );
        return response;
      },
      (err) => {
        console.warn("[scope-cache]", asked, "→ failed:", err);
        throw err;
      },
    ),
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("Range")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const index = INDEXES.find((entry) => url.pathname === entry.index);
  if (index) return answer(event, (e) => readIndex(e, index));
  if (url.pathname.startsWith(LOG_FILES)) return answer(event, readLog);
  if (isApp(url.pathname)) return answer(event, readApp);
  const files = INDEXES.find((entry) => url.pathname.startsWith(entry.files));
  if (files) answer(event, (e) => readFile(e, files));
});
