import { afterEach, describe, expect, test } from "bun:test";
import {
  CHUNK_BYTES,
  type LinkHeader,
  PING,
  PONG,
  decodeFrame,
  encodeFrame,
} from "@g3/worker-edge/link-protocol";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { WorkerLink } from "./link";

// A stand-in for the worker's AgentLink Durable Object: accepts the agent's
// WebSocket, sends it requests, and collects the responses.
function fakeWorker(port = 0) {
  const responses = new Map<string, { header: LinkHeader; body: number[] }>();
  const done = new Map<string, () => void>();
  let socket: ServerWebSocket<unknown> | null = null;
  let connected: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    connected = resolve;
  });
  let auth: string | null = null;
  const server = Bun.serve({
    port,
    fetch(req, srv) {
      auth = req.headers.get("Authorization");
      return srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
    },
    websocket: {
      open(ws) {
        socket = ws;
        connected();
      },
      message(ws, message) {
        if (message === PING) return void ws.send(PONG);
        if (typeof message === "string") return;
        const frame = decodeFrame(new Uint8Array(message));
        if (!frame) return;
        const { header, body } = frame;
        if (header.t === "res") responses.set(header.id, { header, body: [] });
        const r = responses.get(header.id);
        if (!r || (header.t !== "res" && header.t !== "data")) return;
        r.body.push(...body);
        if (header.end) done.get(header.id)?.();
      },
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/api`,
    port: server.port as number,
    ready,
    auth: () => auth,
    stop: () => server.stop(true),
    /** Sends a request over the link and waits for the whole response. */
    async request(id: string, method: string, path: string, body?: Uint8Array) {
      await ready;
      const finished = new Promise<void>((resolve) => done.set(id, resolve));
      socket?.send(encodeFrame({ t: "req", id, method, path, headers: [], end: !body }));
      if (body) socket?.send(encodeFrame({ t: "data", id, end: true }, body));
      await finished;
      const r = responses.get(id);
      if (r?.header.t !== "res") throw new Error("no response");
      return { status: r.header.status, body: new Uint8Array(r.body) };
    },
  };
}

/** Waits for a condition, polling (the client's open event can land after the server's). */
async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(10);
  }
}

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

describe("WorkerLink", () => {
  test("connects with the key, runs requests on the agent's API, and streams answers back", async () => {
    const worker = fakeWorker();
    const seen: (string | null)[] = [];
    const big = "y".repeat(CHUNK_BYTES * 2 + 5);
    const app = new Hono()
      .get("/print/printers", (c) => {
        seen.push(c.req.header("Authorization") ?? null);
        return c.json({ printers: [] });
      })
      .post("/echo", async (c) => c.text(`${(await c.req.arrayBuffer()).byteLength}:${big}`));
    const link = new WorkerLink(worker.url, () => ({ Authorization: "Bearer k" }), app.fetch, "k");
    link.start();
    stops.push(() => link.stop(), worker.stop);
    await until(() => link.status().connected);

    expect(worker.auth()).toBe("Bearer k");
    const res = await worker.request("a", "GET", "/print/printers");
    expect(res.status).toBe(200);
    expect(JSON.parse(new TextDecoder().decode(res.body))).toEqual({ printers: [] });
    // The agent adds its key for its own API.
    expect(seen).toEqual(["Bearer k"]);

    const echoed = await worker.request("b", "POST", "/echo", new Uint8Array(1000));
    expect(new TextDecoder().decode(echoed.body)).toBe(`1000:${big}`);
    expect(link.status().connected).toBe(true);
  });

  test("reconnects by itself after the worker goes away", async () => {
    const worker = fakeWorker();
    const link = new WorkerLink(
      worker.url,
      () => ({}),
      () => new Response("ok"),
      "k",
    );
    link.start();
    stops.push(() => link.stop());
    await until(() => link.connects === 1);

    // The worker restarts (a deploy, say) on the same address.
    worker.stop();
    await Bun.sleep(50);
    expect(link.status().connected).toBe(false);
    const again = fakeWorker(worker.port);
    stops.push(again.stop);
    await until(() => link.connects === 2);
    expect((await again.request("c", "GET", "/")).status).toBe(200);
  });
});
