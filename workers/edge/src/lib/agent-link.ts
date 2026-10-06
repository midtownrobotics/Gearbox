import { DurableObject } from "cloudflare:workers";
import type { AppEnv } from "../types";
import {
  type LinkHeader,
  PING,
  PONG,
  decodeFrame,
  encodeFrame,
  headerPairs,
  sendMessage,
} from "./link-protocol";

/** On the Durable Object's own requests: how long to wait for the agent (ms). */
export const LINK_TIMEOUT_HEADER = "X-G3-Link-Timeout";
/** On its answers when the agent couldn't be asked: "offline" or "timeout". */
export const LINK_ERROR_HEADER = "X-G3-Link-Error";
/** Its control paths; the agent's own paths never start with "/__". */
export const CONNECT_PATH = "/__connect";
export const STATUS_PATH = "/__status";

export interface LinkStatus {
  connected: boolean;
  /** When the current connection opened (unix seconds). */
  connectedAt: number | null;
  /** The last heartbeat the agent sent (unix seconds). */
  lastHeartbeatAt: number | null;
  agentVersion: string | null;
}

interface Attachment {
  connId: string;
  connectedAt: number;
  agentVersion: string | null;
}

interface Pending {
  connId: string;
  resolve: (res: Response) => void;
  /** Set once the response's header has arrived and its body is streaming. */
  body: ReadableStreamDefaultController<Uint8Array> | null;
  timer: ReturnType<typeof setTimeout>;
}

const linkError = (kind: "offline" | "timeout", message: string) =>
  new Response(message, { status: 503, headers: { [LINK_ERROR_HEADER]: kind } });

/** Statuses whose responses can't carry a body. */
const NO_BODY = new Set([101, 204, 205, 304]);

/**
 * Holds the edge box's WebSocket (one box, so one instance: `agentLink(env)`),
 * and turns the worker's requests to the agent into frames on it. Uses the
 * hibernation API: an idle connection costs nothing, and heartbeats are
 * answered without waking it. A request in flight keeps it awake, so the
 * pending map lives as long as anything is waiting on it.
 */
export class AgentLink extends DurableObject<AppEnv["Bindings"]> {
  private pending = new Map<string, Pending>();

  constructor(ctx: DurableObjectState, env: AppEnv["Bindings"]) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === CONNECT_PATH) return this.acceptAgent(request);
    if (pathname === STATUS_PATH) return Response.json(this.status());
    return this.forward(request);
  }

  /** The newest open socket; older ones are closed when a new one connects. */
  private socket(): { ws: WebSocket; info: Attachment } | null {
    let best: { ws: WebSocket; info: Attachment } | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const info = ws.deserializeAttachment() as Attachment | null;
      if (info && (!best || info.connectedAt > best.info.connectedAt)) best = { ws, info };
    }
    return best;
  }

  private status(): LinkStatus {
    const current = this.socket();
    if (!current) {
      return { connected: false, connectedAt: null, lastHeartbeatAt: null, agentVersion: null };
    }
    const beat = this.ctx.getWebSocketAutoResponseTimestamp(current.ws);
    return {
      connected: true,
      connectedAt: current.info.connectedAt,
      lastHeartbeatAt: beat ? Math.floor(beat.getTime() / 1000) : null,
      agentVersion: current.info.agentVersion,
    };
  }

  /** The worker has already checked the agent's key. */
  private acceptAgent(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }
    // A reconnecting box replaces its old connection (which may be half-dead).
    for (const old of this.ctx.getWebSockets()) old.close(4000, "Replaced by a new connection.");
    const { 0: client, 1: server } = new WebSocketPair();
    const info: Attachment = {
      connId: crypto.randomUUID(),
      connectedAt: Math.floor(Date.now() / 1000),
      agentVersion: request.headers.get("X-G3-Agent-Version"),
    };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(info);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Sends one request to the agent and resolves with its response (streamed). */
  private forward(request: Request): Promise<Response> {
    const current = this.socket();
    if (!current) {
      return Promise.resolve(linkError("offline", "The edge box isn't connected."));
    }
    const { ws, info } = current;
    const url = new URL(request.url);
    const timeoutMs = Number(request.headers.get(LINK_TIMEOUT_HEADER)) || 15_000;
    const headers = new Headers(request.headers);
    headers.delete(LINK_TIMEOUT_HEADER);
    const id = crypto.randomUUID();

    return new Promise<Response>((resolve) => {
      const timer = setTimeout(() => {
        this.finish(id, new Error("The edge box didn't respond in time."), "timeout");
        try {
          ws.send(encodeFrame({ t: "cancel", id }));
        } catch {}
      }, timeoutMs);
      this.pending.set(id, { connId: info.connId, resolve, body: null, timer });
      const send = (frame: Uint8Array) => ws.send(frame);
      sendMessage(
        send,
        {
          t: "req",
          id,
          method: request.method,
          path: url.pathname + url.search,
          headers: headerPairs(headers),
          end: true,
        },
        request.body,
      ).catch(() => this.finish(id, new Error("The edge box disconnected."), "offline"));
    });
  }

  /** Ends a pending request: with an error, or (no error) after its body's last piece. */
  private finish(id: string, error?: Error, kind: "offline" | "timeout" = "offline") {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (!error) {
      p.body?.close();
    } else if (p.body) {
      p.body.error(error);
    } else {
      p.resolve(linkError(kind, error.message));
    }
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === "string") return;
    const frame = decodeFrame(message);
    if (!frame) return;
    const { header, body } = frame;
    const p = this.pending.get(header.id);
    if (!p) return;
    if (header.t === "res") this.onResponse(header, p);
    else if (header.t === "data" && p.body) {
      if (body.length) p.body.enqueue(body);
      if (header.end) this.finish(header.id);
    }
  }

  private onResponse(header: Extract<LinkHeader, { t: "res" }>, p: Pending) {
    const headers = new Headers(header.headers);
    // A "res" frame carries no body bytes; any body follows as "data" frames.
    if (header.end || NO_BODY.has(header.status)) {
      p.resolve(new Response(null, { status: header.status, headers }));
      if (header.end) this.finish(header.id);
      return;
    }
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        p.body = controller;
      },
    });
    p.resolve(new Response(stream, { status: header.status, headers }));
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.dropConnection(ws);
    // Completes the closing handshake; a socket that's already closed throws.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "Closed.");
    } catch {}
  }

  async webSocketError(ws: WebSocket) {
    this.dropConnection(ws);
  }

  /** Fails whatever was waiting on this connection. */
  private dropConnection(ws: WebSocket) {
    const info = ws.deserializeAttachment() as Attachment | null;
    for (const [id, p] of this.pending) {
      if (!info || p.connId === info.connId) {
        this.finish(id, new Error("The edge box disconnected."), "offline");
      }
    }
  }
}

/** The one box's link. */
export const agentLink = (env: AppEnv["Bindings"]) =>
  env.AGENT_LINK.get(env.AGENT_LINK.idFromName("edge-box"));
