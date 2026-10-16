import { Hono } from "hono";
import type { EdgeModule, ModuleContext } from "../../core/module";
import { DRIVE_PAGE } from "./page";
import { DriveError, DriveStore, parseRange } from "./store";

/** Uploads can be up to the whole drive; the filesystem enforces the real limit. */
const MAX_UPLOAD_BYTES = 11 * 1024 ** 3;
const RETRY_LISTEN_MS = 30_000;

/**
 * Shop drive: a 10 GB shared folder served by the box on the shop LAN
 * (http://drive.local). Anyone on the network can upload, download, and
 * delete. It has its own web server on the LAN address only, separate from
 * the agent API: it's never reachable over the worker link, so file traffic
 * never crosses the internet.
 */
export function createDriveModule(ctx: ModuleContext): EdgeModule {
  const store = new DriveStore(ctx.config.driveDir, !ctx.config.mock);
  const { driveHost: host, drivePort: port } = ctx.config;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let retry: Timer | null = null;
  let listenError: string | null = null;

  const fail = (err: unknown) => {
    if (err instanceof DriveError)
      return Response.json({ error: err.message }, { status: err.status });
    console.error("[drive]", err);
    return Response.json({ error: "Something went wrong on the box." }, { status: 500 });
  };

  const app = new Hono()
    .get("/", (c) => c.html(DRIVE_PAGE))
    .get("/api/files", () => {
      try {
        return Response.json({ files: store.list(), ...store.usage() });
      } catch (err) {
        return fail(err);
      }
    })
    .put("/api/files/:name", async (c) => {
      try {
        const length = c.req.header("Content-Length");
        const name = await store.upload(
          c.req.param("name"),
          c.req.raw.body,
          length ? Number(length) : null,
        );
        console.log(`[drive] uploaded "${name}" (${length ?? "?"} bytes)`);
        return Response.json({ ok: true, name });
      } catch (err) {
        return fail(err);
      }
    })
    .delete("/api/files/:name", (c) => {
      try {
        store.remove(c.req.param("name"));
        return Response.json({ ok: true });
      } catch (err) {
        return fail(err);
      }
    })
    // Downloads support Range requests, so browsers can resume them.
    .on(["GET", "HEAD"], "/files/:name", (c) => {
      try {
        const { name, path } = store.file(c.req.param("name"));
        const file = Bun.file(path);
        const headers = new Headers({
          "Accept-Ranges": "bytes",
          "Content-Type": file.type || "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          "Cache-Control": "no-store",
        });
        const range = parseRange(c.req.header("Range"), file.size);
        if (range === "unsatisfiable") {
          headers.set("Content-Range", `bytes */${file.size}`);
          return new Response(null, { status: 416, headers });
        }
        if (range) {
          headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`);
          headers.set("Content-Length", String(range.end - range.start + 1));
          return new Response(file.slice(range.start, range.end + 1), { status: 206, headers });
        }
        headers.set("Content-Length", String(file.size));
        return new Response(file, { headers });
      } catch (err) {
        return fail(err);
      }
    });

  // The LAN address may not exist yet at boot; keep trying until it does.
  function listen() {
    try {
      server = Bun.serve({
        hostname: host,
        port,
        fetch: app.fetch,
        maxRequestBodySize: MAX_UPLOAD_BYTES,
      });
      listenError = null;
      console.log(`[drive] serving http://${host}:${port}`);
    } catch (err) {
      listenError = err instanceof Error ? err.message : String(err);
      console.warn(`[drive] can't listen on ${host}:${port} (${listenError}); retrying`);
      retry = setTimeout(listen, RETRY_LISTEN_MS);
    }
  }

  return {
    name: "drive",
    start() {
      store.cleanupTemp();
      listen();
    },
    stop() {
      if (retry) clearTimeout(retry);
      server?.stop();
    },
    status() {
      let storage: Record<string, unknown>;
      try {
        store.check();
        storage = { ok: true, files: store.list().length, ...store.usage() };
      } catch (err) {
        storage = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      return { listening: server !== null, url: `http://${host}:${port}`, listenError, storage };
    },
  };
}
