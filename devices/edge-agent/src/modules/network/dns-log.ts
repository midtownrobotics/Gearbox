// SPDX-License-Identifier: AGPL-3.0-only
import type { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { getMeta, setMeta } from "../../core/db";

/** Don't read more than this per collection (e.g. after a long outage). */
const MAX_READ_BYTES = 64 * 1024 * 1024;

/** File identity and size, or null if it doesn't exist. Other errors (e.g. permissions) throw. */
function stat(path: string) {
  try {
    const s = statSync(path);
    return { ino: s.ino, size: s.size };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Reads new lines from dnsmasq's query log since the last call, remembering
 * the position across restarts. Handles logrotate in `create` mode: when the
 * file is replaced (new inode), the rest of the rotated copy (`<path>.1`) is
 * read first. `copytruncate` is not supported, since a truncated file that
 * has regrown past the old position can't be told apart from a normal one.
 */
export class DnsLogTailer {
  constructor(
    private path: string,
    private db: Database,
  ) {}

  async read(): Promise<string[]> {
    const current = stat(this.path);
    if (!current) return [];
    const saved = getMeta(this.db, "dns_log_pos");
    let [ino, offset] = saved ? saved.split(":").map(Number) : [current.ino, 0];

    let text = "";
    if (ino !== current.ino || current.size < offset) {
      const rotated = stat(`${this.path}.1`);
      if (rotated && rotated.size >= offset)
        text += await this.slice(`${this.path}.1`, offset, rotated.size);
      ino = current.ino;
      offset = 0;
    }
    const end = Math.min(current.size, offset + MAX_READ_BYTES);
    const fresh = await this.slice(this.path, offset, end);
    // Only consume complete lines; a partial last line is read next time.
    const lastNewline = fresh.lastIndexOf("\n");
    const complete = lastNewline === -1 ? "" : fresh.slice(0, lastNewline + 1);
    offset += Buffer.byteLength(complete);
    text += complete;

    setMeta(this.db, "dns_log_pos", `${ino}:${offset}`);
    return text.split("\n").filter(Boolean);
  }

  private slice(path: string, start: number, end: number) {
    return end > start ? Bun.file(path).slice(start, end).text() : Promise.resolve("");
  }
}
