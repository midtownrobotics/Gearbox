/**
 * The edge box's link: one WebSocket the agent opens to the worker
 * (GET /agent/connect), over which the worker sends HTTP requests to the
 * agent's local API and gets the responses back. Shared by the worker's
 * AgentLink Durable Object and the agent (`@g3/worker-edge/link-protocol`).
 *
 * Every binary message is one frame: a 4-byte big-endian header length, the
 * JSON header, then body bytes. Bodies are split into frames of at most
 * CHUNK_BYTES (a print job can be 50 MB; a WebSocket message can't), each
 * marked `end` when it's the last. Text messages are only the heartbeat:
 * the agent sends "ping", and the Durable Object auto-answers "pong".
 */

export const PING = "ping";
export const PONG = "pong";
export const CHUNK_BYTES = 256 * 1024;

export type Pairs = [string, string][];

export type LinkHeader =
  /** Worker → agent: start of a request. `end` when there's no body to follow. */
  | { t: "req"; id: string; method: string; path: string; headers: Pairs; end: boolean }
  /** Agent → worker: start of the response. */
  | { t: "res"; id: string; status: number; headers: Pairs; end: boolean }
  /** Either way: the next piece of a body. */
  | { t: "data"; id: string; end: boolean }
  /** Worker → agent: the worker gave up waiting; drop the request. */
  | { t: "cancel"; id: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const EMPTY = new Uint8Array(0);

export function encodeFrame(header: LinkHeader, body: Uint8Array = EMPTY): Uint8Array {
  const json = encoder.encode(JSON.stringify(header));
  const out = new Uint8Array(4 + json.length + body.length);
  new DataView(out.buffer).setUint32(0, json.length);
  out.set(json, 4);
  out.set(body, 4 + json.length);
  return out;
}

/** Returns null for anything that isn't a well-formed frame. */
export function decodeFrame(
  data: ArrayBuffer | Uint8Array,
): { header: LinkHeader; body: Uint8Array } | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 4) return null;
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (4 + length > bytes.length) return null;
  try {
    const header = JSON.parse(decoder.decode(bytes.subarray(4, 4 + length))) as LinkHeader;
    if (typeof header?.t !== "string" || typeof header.id !== "string") return null;
    return { header, body: bytes.subarray(4 + length) };
  } catch {
    return null;
  }
}

/** Reads a body stream in pieces of at most `size` bytes (the last may be shorter). */
export async function* chunks(
  stream: ReadableStream<Uint8Array> | null,
  size = CHUNK_BYTES,
): AsyncGenerator<Uint8Array> {
  if (!stream) return;
  const reader = stream.getReader();
  let buffer = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (value?.length) {
      const joined = new Uint8Array(buffer.length + value.length);
      joined.set(buffer);
      joined.set(value, buffer.length);
      buffer = joined;
      while (buffer.length >= size) {
        yield buffer.slice(0, size);
        buffer = buffer.slice(size);
      }
    }
    if (done) break;
  }
  if (buffer.length > 0) yield buffer;
}

/**
 * Sends a header frame and then the body, if any, as data frames. The header's
 * `end` is set when there's no body, so the other side needn't wait for one.
 */
export async function sendMessage(
  send: (frame: Uint8Array) => void,
  header: Extract<LinkHeader, { t: "req" | "res" }>,
  body: ReadableStream<Uint8Array> | null,
) {
  if (!body) {
    send(encodeFrame({ ...header, end: true }));
    return;
  }
  send(encodeFrame({ ...header, end: false }));
  let previous: Uint8Array | null = null;
  // Hold one piece back, so the last can be marked `end`.
  for await (const piece of chunks(body)) {
    if (previous) send(encodeFrame({ t: "data", id: header.id, end: false }, previous));
    previous = piece;
  }
  send(encodeFrame({ t: "data", id: header.id, end: true }, previous ?? EMPTY));
}

/** Headers that belong to one hop and mustn't be passed on. */
const HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

export const headerPairs = (headers: Headers): Pairs =>
  [...headers].filter(([name]) => !HOP_HEADERS.has(name) && !name.startsWith("cf-"));
