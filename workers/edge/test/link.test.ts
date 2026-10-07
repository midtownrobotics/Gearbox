import { admin, asUser, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  CHUNK_BYTES,
  type LinkHeader,
  PING,
  PONG,
  decodeFrame,
  encodeFrame,
  sendMessage,
} from "../src/lib/link-protocol";

// The box's link: the agent opens a WebSocket to /agent/connect, and the worker's requests to the
// box go over it. Here the test plays the agent.

// The site team's box key, made by an admin like on the Edge Box page.
let AGENT_KEY = "";
beforeAll(async () => {
  AGENT_KEY = (await jsonAs<{ key: string }>(admin, "/box/key", { method: "POST" }, 201)).key;
});

type Handler = (req: {
  method: string;
  path: string;
  headers: Headers;
  body: Uint8Array;
}) => Response | Promise<Response> | null;

const open: WebSocket[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.close(1000);
});

/** Connects as the agent; `handle` answers each request (null: never answer). */
async function connectAgent(handle: Handler, key = AGENT_KEY) {
  const res = await call("/agent/connect", {
    headers: {
      Upgrade: "websocket",
      Authorization: `Bearer ${key}`,
      "X-G3-Agent-Version": "test",
      "X-G3-Agent-Started": "1000",
    },
  });
  const ws = res.webSocket;
  if (!ws) return { res, ws: null };
  ws.accept();
  open.push(ws);
  const incoming = new Map<
    string,
    { header: Extract<LinkHeader, { t: "req" }>; parts: Uint8Array[] }
  >();
  ws.addEventListener("message", async (event) => {
    if (typeof event.data === "string") return;
    // A client socket here gets binary messages as Blobs.
    const raw = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
    const frame = decodeFrame(raw as ArrayBuffer);
    if (!frame) return;
    const { header, body } = frame;
    if (header.t === "req") incoming.set(header.id, { header, parts: [] });
    const req = incoming.get(header.id);
    if (!req || (header.t !== "req" && header.t !== "data")) return;
    if (body.length) req.parts.push(body);
    if (!header.end) return;
    incoming.delete(header.id);
    const size = req.parts.reduce((n, p) => n + p.length, 0);
    const all = new Uint8Array(size);
    let at = 0;
    for (const p of req.parts) {
      all.set(p, at);
      at += p.length;
    }
    const answer = await handle({
      method: req.header.method,
      path: req.header.path,
      headers: new Headers(req.header.headers),
      body: all,
    });
    if (!answer) return;
    await sendMessage(
      (f) => ws.send(f),
      { t: "res", id: header.id, status: answer.status, headers: [...answer.headers], end: true },
      answer.body,
    );
  });
  return { res, ws };
}

type Connection = { state: string; latencyMs: number | null; connectedAt: number | null };

describe("the box's link", () => {
  it("only lets the agent connect", async () => {
    const { res, ws } = await connectAgent(() => null, "wrong-key");
    expect(res.status).toBe(401);
    expect(ws).toBeNull();
  });

  it("says the box is offline when nothing is connected", async () => {
    const connection = await jsonAs<Connection>(student, "/status/connection");
    expect(connection.state).toBe("offline");
    const res = await callAs(student, "/status/interfaces");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/isn't connected/);
  });

  it("sends the worker's requests to the agent and relays the answers", async () => {
    const seen: { method: string; path: string; auth: string | null }[] = [];
    await connectAgent(({ method, path, headers }) => {
      seen.push({ method, path, auth: headers.get("Authorization") });
      if (path === "/health") return Response.json({ version: "test" });
      if (path === "/network/interfaces") {
        return Response.json({
          checkedAt: 1,
          interfaces: [
            {
              role: "lan",
              name: "lan0",
              state: "up",
              mac: null,
              addresses: [{ address: "192.168.50.1", prefixLength: 24, family: "ipv4" }],
            },
          ],
        });
      }
      return new Response("404 Not Found", { status: 404 });
    });

    const connection = await jsonAs<Connection>(student, "/status/connection");
    expect(connection.state).toBe("connected");
    expect(connection.connectedAt).toBeTypeOf("number");

    const addresses = await jsonAs<{ interfaces: { addresses: { address: string }[] }[] }>(
      student,
      "/status/interfaces",
    );
    expect(addresses.interfaces[0].addresses[0].address).toBe("192.168.50.1");
    // The agent adds its own key; the worker doesn't send it over the link.
    expect(seen.find((s) => s.path === "/network/interfaces")).toEqual({
      method: "GET",
      path: "/network/interfaces",
      auth: null,
    });
  });

  it("carries bodies bigger than one frame both ways", async () => {
    const size = CHUNK_BYTES * 2 + 123;
    await connectAgent(({ path, body }) => {
      if (path.startsWith("/switch/sounds")) {
        // Echo what arrived: its size and a checksum, and a big body back.
        let sum = 0;
        for (const b of body) sum = (sum + b) % 65521;
        return Response.json({ size: body.length, sum, pad: "x".repeat(size) });
      }
      return Response.json({});
    });
    const data = new Uint8Array(size);
    data.set(new TextEncoder().encode("RIFF"), 0);
    data.set(new TextEncoder().encode("WAVE"), 8);
    for (let i = 12; i < size; i++) data[i] = i % 251;
    let sum = 0;
    for (const b of data) sum = (sum + b) % 65521;

    const res = await call("/switch/sounds?name=test-sound.wav", {
      ...asUser(admin, {
        method: "POST",
        headers: { "Content-Type": "audio/wav", "Content-Length": String(size) },
      }),
      body: data,
    });
    expect(res.status).toBe(200);
    const echoed = (await res.json()) as { size: number; sum: number; pad: string };
    expect(echoed.size).toBe(size);
    expect(echoed.sum).toBe(sum);
    expect(echoed.pad.length).toBe(size);
  });

  it("answers heartbeats", async () => {
    const { ws } = await connectAgent(() => null);
    const pong = new Promise<string>((resolve) =>
      ws?.addEventListener("message", (e) => {
        if (typeof e.data === "string") resolve(e.data);
      }),
    );
    ws?.send(PING);
    expect(await pong).toBe(PONG);
  });

  it("fails a request when the box disconnects mid-way", async () => {
    const { ws } = await connectAgent(() => {
      // Never answer; hang up instead.
      setTimeout(() => ws?.close(1000), 10);
      return null;
    });
    const res = await callAs(student, "/status/interfaces");
    expect(res.status).toBe(503);
  });
});

describe("link frames", () => {
  it("round-trip a header and body", () => {
    const body = new Uint8Array([1, 2, 3]);
    const frame = decodeFrame(encodeFrame({ t: "data", id: "x", end: true }, body));
    expect(frame?.header).toEqual({ t: "data", id: "x", end: true });
    expect([...(frame?.body ?? [])]).toEqual([1, 2, 3]);
    expect(decodeFrame(new Uint8Array([0, 0, 0, 99, 1]))).toBeNull();
  });
});
