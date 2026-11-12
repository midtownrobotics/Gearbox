// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from "node:fs";
import { userInfo } from "node:os";

/**
 * Minimal IPP/1.1 client (RFC 8010) for reading printer and job status from
 * the local CUPS server. Only what the print module needs: encoding simple
 * requests and decoding flat attribute groups.
 */

const GROUP = { operation: 0x01, job: 0x02, end: 0x03, printer: 0x04 } as const;
export const VALUE = {
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  text: 0x41,
  name: 0x42,
  keyword: 0x44,
  uri: 0x45,
  charset: 0x47,
  naturalLanguage: 0x48,
} as const;

export const OP = {
  getJobs: 0x000a,
  cupsGetDefault: 0x4001,
  cupsGetPrinters: 0x4002,
} as const;

type Value = string | number | boolean | null;
export type Attrs = Record<string, Value[]>;
export type RequestAttr = [tag: number, name: string, values: (string | number | boolean)[]];

export function encodeRequest(op: number, requestId: number, attrs: RequestAttr[]): Uint8Array {
  const bytes: number[] = [0x02, 0x00, op >> 8, op & 0xff];
  const u32 = (n: number) =>
    bytes.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  const u16 = (n: number) => bytes.push((n >> 8) & 0xff, n & 0xff);
  const str = (s: string) => {
    const b = new TextEncoder().encode(s);
    u16(b.length);
    bytes.push(...b);
  };
  u32(requestId);
  bytes.push(GROUP.operation);
  const all: RequestAttr[] = [
    [VALUE.charset, "attributes-charset", ["utf-8"]],
    [VALUE.naturalLanguage, "attributes-natural-language", ["en"]],
    ...attrs,
    [VALUE.name, "requesting-user-name", [userInfo().username]],
  ];
  for (const [tag, name, values] of all) {
    values.forEach((v, i) => {
      bytes.push(tag);
      str(i === 0 ? name : "");
      if (typeof v === "number") {
        u16(4);
        u32(v);
      } else if (typeof v === "boolean") {
        u16(1);
        bytes.push(v ? 1 : 0);
      } else {
        str(v);
      }
    });
  }
  bytes.push(GROUP.end);
  return new Uint8Array(bytes);
}

export interface IppResponse {
  status: number;
  groups: { tag: number; attrs: Attrs }[];
}

export function decodeResponse(buf: Uint8Array): IppResponse {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const text = new TextDecoder();
  const status = view.getUint16(2);
  const groups: IppResponse["groups"] = [];
  let group: IppResponse["groups"][number] | null = null;
  let last: string | null = null;
  let i = 8;
  while (i < buf.length) {
    const tag = buf[i++];
    if (tag === GROUP.end) break;
    if (tag < 0x10) {
      group = { tag, attrs: {} };
      groups.push(group);
      last = null;
      continue;
    }
    const nameLen = view.getUint16(i);
    i += 2;
    const name: string | null = nameLen ? text.decode(buf.subarray(i, i + nameLen)) : last;
    i += nameLen;
    const valueLen = view.getUint16(i);
    i += 2;
    const raw = buf.subarray(i, i + valueLen);
    i += valueLen;
    if (!group || !name) continue;
    last = name;
    let value: Value;
    if ((tag === VALUE.integer || tag === VALUE.enum) && valueLen === 4) {
      value = new DataView(raw.buffer, raw.byteOffset, 4).getInt32(0);
    } else if (tag === VALUE.boolean && valueLen === 1) {
      value = raw[0] === 1;
    } else if (tag >= 0x40 && tag <= 0x49) {
      value = text.decode(raw);
    } else if (tag === 0x35 || tag === 0x36) {
      // textWithLanguage / nameWithLanguage: skip the language prefix.
      const langLen = (raw[0] << 8) | raw[1];
      const textLen = (raw[2 + langLen] << 8) | raw[3 + langLen];
      value = text.decode(raw.subarray(4 + langLen, 4 + langLen + textLen));
    } else if (tag === 0x10 || tag === 0x12 || tag === 0x13) {
      value = null; // unsupported / unknown / no-value
    } else {
      continue; // dateTime, ranges, collections, ...: not needed here.
    }
    const values = group.attrs[name] ?? [];
    values.push(value);
    group.attrs[name] = values;
  }
  return { status, groups };
}

const CUPS_SOCKET = "/run/cups/cups.sock";

/**
 * Where CUPS listens: $CUPS_SERVER (host:port or a socket path), else the
 * local socket. The socket matters: CUPS identifies the caller by its Unix
 * user there, and only shows job titles and owners to admins (lpadmin group).
 */
function cupsEndpoint() {
  const server =
    process.env.CUPS_SERVER ?? (existsSync(CUPS_SOCKET) ? CUPS_SOCKET : "localhost:631");
  if (server.startsWith("/")) return { url: "http://localhost/", unix: server, host: "localhost" };
  const host = server.includes(":") ? server : `${server}:631`;
  return { url: `http://${host}/`, unix: undefined, host: host.split(":")[0] };
}

/** The ipp:// URI for the local server, as CUPS expects in requests. */
export function serverUri(path = "/") {
  return `ipp://${cupsEndpoint().host}${path}`;
}

let requestId = 1;

export async function ippRequest(op: number, attrs: RequestAttr[]): Promise<IppResponse> {
  const { url, unix } = cupsEndpoint();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/ipp" },
    body: encodeRequest(op, requestId++, attrs),
    ...(unix ? { unix } : {}),
    signal: AbortSignal.timeout(10_000),
  } as RequestInit);
  if (!res.ok) throw new Error(`CUPS returned HTTP ${res.status}`);
  const decoded = decodeResponse(new Uint8Array(await res.arrayBuffer()));
  // 0x0000-0x00ff are successful; 0x0406 = "not found" (e.g. no jobs/printers).
  if (decoded.status > 0x00ff && decoded.status !== 0x0406) {
    throw new Error(`CUPS IPP error 0x${decoded.status.toString(16).padStart(4, "0")}`);
  }
  return decoded;
}
