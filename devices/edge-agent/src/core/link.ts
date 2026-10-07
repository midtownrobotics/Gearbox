import {
  type LinkHeader,
  PING,
  PONG,
  decodeFrame,
  headerPairs,
  sendMessage,
} from "@g3/worker-edge/link-protocol";

/** The worker's Durable Object answers pings itself; two missed answers mean the link is dead. */
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 2 * PING_INTERVAL_MS + 10_000;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;
/** A connection that stayed up this long resets the retry delay. */
const STABLE_MS = 30_000;
/** Bigger than any request the worker sends (print jobs are capped at 50 MB). */
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

type Incoming = { header: Extract<LinkHeader, { t: "req" }>; parts: Uint8Array[]; size: number };

/**
 * The box's link to the worker: one WebSocket the agent opens and keeps open
 * (GET /agent/connect, with the shared key), so the worker can reach the agent
 * without anything listening on the internet. The worker sends HTTP requests
 * over it (`@g3/worker-edge/link-protocol`); each runs on the agent's own API,
 * with the key added, and the response goes back the same way.
 */
export class WorkerLink {
  private ws: WebSocket | null = null;
  private incoming = new Map<string, Incoming>();
  private cancelled = new Set<string>();
  private retryTimer: Timer | null = null;
  private pingTimer: Timer | null = null;
  private stableTimer: Timer | null = null;
  private failures = 0;
  private stopped = false;
  private lastPongAt = 0;
  connectedAt: number | null = null;
  lastError: string | null = null;
  connects = 0;

  constructor(
    /** The worker's API base, e.g. https://1648-edge.frcgearbox.com/api */
    private workerUrl: string,
    private headers: () => Record<string, string>,
    /** The agent's API (createAgentApp().fetch). */
    private handle: (request: Request) => Response | Promise<Response>,
    private agentKey: string,
  ) {}

  start() {
    this.stopped = false;
    this.connect();
    this.pingTimer = setInterval(() => this.heartbeat(), PING_INTERVAL_MS);
  }

  stop() {
    this.stopped = true;
    for (const t of [this.retryTimer, this.stableTimer]) if (t) clearTimeout(t);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close(1000, "Agent stopping.");
    this.ws = null;
  }

  status() {
    return {
      connected: this.connectedAt !== null,
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      connects: this.connects,
    };
  }

  private connect() {
    const url = `${this.workerUrl.replace(/^http/, "ws")}/agent/connect`;
    const ws = new WebSocket(url, { headers: this.headers() });
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      this.connectedAt = Math.floor(Date.now() / 1000);
      this.lastPongAt = Date.now();
      this.lastError = null;
      this.connects++;
      console.log("[link] connected to the worker");
      this.stableTimer = setTimeout(() => {
        this.failures = 0;
      }, STABLE_MS);
    });
    ws.addEventListener("message", (event) => {
      if (this.ws === ws) void this.onMessage(ws, event.data);
    });
    ws.addEventListener("error", () => {
      if (this.ws === ws) this.lastError = "The connection to the worker failed.";
    });
    ws.addEventListener("close", (event) => {
      if (this.ws !== ws) return;
      const opened = this.connectedAt !== null;
      if (event.code !== 1000 && event.code !== 1006) {
        this.lastError = `Closed by the worker (${event.code}${event.reason ? `: ${event.reason}` : ""}).`;
      }
      this.reconnectLater();
      if (!opened) void this.diagnose(url);
    });
  }

  /**
   * A refused upgrade doesn't say why, so ask the same address over plain
   * HTTP: the worker answers 401 for a wrong key, 426 when all is well but
   * it wanted a WebSocket.
   */
  private async diagnose(url: string) {
    try {
      const res = await fetch(url.replace(/^ws/, "http"), {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      const reasons: Record<number, string> = {
        401: "The worker refused the agent's key (EDGE_AGENT_KEY isn't the team's box key; make a new one on the Edge Box page).",
        404: "The worker has no link endpoint (it's older than this agent, or EDGE_WORKER_URL is wrong).",
        410: "EDGE_WORKER_URL is a retired address; use the one in agent.env.example.",
      };
      if (this.connectedAt === null) {
        this.lastError = reasons[res.status] ?? `Couldn't connect (HTTP ${res.status}).`;
        console.warn(`[link] ${this.lastError}`);
      }
    } catch (err) {
      if (this.connectedAt === null) {
        this.lastError = `Couldn't reach the worker: ${err instanceof Error ? err.message : err}`;
      }
    }
  }

  /** Drops the current socket and tries again after a backoff delay. */
  private reconnectLater() {
    const wasConnected = this.connectedAt !== null;
    this.ws = null;
    this.connectedAt = null;
    this.incoming.clear();
    this.cancelled.clear();
    if (this.stableTimer) clearTimeout(this.stableTimer);
    if (this.stopped) return;
    if (wasConnected)
      console.warn(`[link] disconnected${this.lastError ? `: ${this.lastError}` : ""}`);
    const base = Math.min(MAX_RETRY_MS, MIN_RETRY_MS * 2 ** this.failures);
    this.failures++;
    const delay = base / 2 + Math.random() * (base / 2);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private heartbeat() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastPongAt > PONG_TIMEOUT_MS) {
      // The hotspot or a NAT dropped it without a close; don't wait for TCP to notice.
      this.lastError = "No heartbeat answer from the worker.";
      ws.terminate();
      this.reconnectLater();
      return;
    }
    ws.send(PING);
  }

  private async onMessage(ws: WebSocket, data: unknown) {
    if (typeof data === "string") {
      if (data === PONG) this.lastPongAt = Date.now();
      return;
    }
    if (!(data instanceof ArrayBuffer)) return;
    const frame = decodeFrame(data);
    if (!frame) return;
    const { header, body } = frame;
    if (header.t === "cancel") {
      this.incoming.delete(header.id);
      this.cancelled.add(header.id);
      return;
    }
    if (header.t === "req") {
      this.incoming.set(header.id, { header, parts: [], size: 0 });
      if (header.end) await this.dispatch(ws, header.id);
      return;
    }
    if (header.t === "data") {
      const req = this.incoming.get(header.id);
      if (!req) return;
      req.parts.push(body);
      req.size += body.length;
      if (req.size > MAX_REQUEST_BYTES) {
        this.incoming.delete(header.id);
        await this.reply(ws, header.id, Response.json({ error: "Too large." }, { status: 413 }));
        return;
      }
      if (header.end) await this.dispatch(ws, header.id);
    }
  }

  private async dispatch(ws: WebSocket, id: string) {
    const req = this.incoming.get(id);
    if (!req) return;
    this.incoming.delete(id);
    const { method, path, headers } = req.header;
    const init: RequestInit = { method, headers };
    if (req.size > 0 && method !== "GET" && method !== "HEAD") init.body = Buffer.concat(req.parts);
    const request = new Request(`http://agent${path}`, init);
    // The link itself was opened with the key, so the request is the worker's.
    request.headers.set("Authorization", `Bearer ${this.agentKey}`);
    let res: Response;
    try {
      res = await this.handle(request);
    } catch (err) {
      console.error(`[link] ${method} ${path} failed:`, err);
      res = Response.json({ error: "The agent failed to handle the request." }, { status: 500 });
    }
    await this.reply(ws, id, res);
  }

  private async reply(ws: WebSocket, id: string, res: Response) {
    if (this.cancelled.delete(id)) return;
    const send = (frame: Uint8Array) => {
      if (ws.readyState !== WebSocket.OPEN) throw new Error("The link closed.");
      ws.send(frame);
    };
    try {
      await sendMessage(
        send,
        { t: "res", id, status: res.status, headers: headerPairs(res.headers), end: true },
        res.body,
      );
    } catch (err) {
      console.warn("[link] couldn't send a response:", err instanceof Error ? err.message : err);
    }
  }
}
