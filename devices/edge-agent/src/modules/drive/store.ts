// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";

/** A problem to report to the uploader with an HTTP status. */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503 | 507,
  ) {
    super(message);
  }
}

const TEMP_PREFIX = ".upload-";

/**
 * Accepts a plain file name (no folders) and returns it trimmed, or null.
 * Rejects paths, "." / "..", hidden names (used for in-progress uploads),
 * control characters, and names over 255 bytes.
 */
export function safeName(raw: string): string | null {
  const name = raw.trim();
  if (!name || name === "." || name === "..") return null;
  if (name.startsWith(".")) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[/\\\u0000-\u001f\u007f]/.test(name)) return null;
  if (new TextEncoder().encode(name).length > 255) return null;
  return name;
}

/** "report.pdf" → "report (1).pdf" (then 2, 3, ...) until `taken` says it's free. */
export function uniqueName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let i = 1; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken(candidate)) return candidate;
  }
}

/**
 * Parses a single-range "Range: bytes=start-end" header (what browsers send
 * to resume a download). Returns null for no/unsupported ranges (send the
 * whole file) or "unsatisfiable".
 */
export function parseRange(header: string | undefined, size: number) {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    // "bytes=-500": the last 500 bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "unsatisfiable" as const;
  return { start, end };
}

export interface DriveFile {
  name: string;
  size: number;
  modifiedAt: number;
}

/**
 * The shop drive: a flat folder of files. On the box it's a mounted 10 GB
 * filesystem image, so a full drive can never fill the box's own disk; with
 * `requireMount`, everything refuses to work if the image isn't mounted.
 */
export class DriveStore {
  constructor(
    readonly dir: string,
    private requireMount: boolean,
  ) {
    if (!requireMount) mkdirSync(dir, { recursive: true });
  }

  /** Throws unless the drive's storage is ready. */
  check() {
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(this.dir);
    } catch {
      throw new DriveError("The drive's storage isn't set up on the box yet.", 503);
    }
    if (this.requireMount && st.dev === statSync(dirname(this.dir)).dev) {
      throw new DriveError("The drive's storage isn't mounted on the box.", 503);
    }
  }

  usage() {
    const s = statfsSync(this.dir);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, used: total - s.bfree * s.bsize };
  }

  list(): DriveFile[] {
    this.check();
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => {
        const st = statSync(join(this.dir, e.name));
        return { name: e.name, size: st.size, modifiedAt: Math.floor(st.mtimeMs / 1000) };
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
  }

  /** Path of an existing file, or a 404. */
  file(rawName: string) {
    this.check();
    const name = safeName(rawName);
    const path = name ? join(this.dir, name) : null;
    if (!path || !statSync(path, { throwIfNoEntry: false })?.isFile()) {
      throw new DriveError("That file isn't on the drive.", 404);
    }
    return { name: name as string, path };
  }

  /**
   * Streams an upload to a temp file, then renames it into place (renamed
   * if the name is taken, never overwriting). Returns the final name.
   */
  async upload(rawName: string, body: ReadableStream<Uint8Array> | null, length: number | null) {
    this.check();
    const name = safeName(rawName);
    if (!name) throw new DriveError("That file name isn't allowed.", 400);
    if (!body) throw new DriveError("The upload was empty.", 400);
    if (length !== null && length > this.usage().free) {
      throw new DriveError("There isn't enough space left on the drive for this file.", 507);
    }
    const tmp = join(this.dir, `${TEMP_PREFIX}${crypto.randomUUID()}`);
    try {
      await Bun.write(tmp, new Response(body));
    } catch (err) {
      rmSync(tmp, { force: true });
      if ((err as NodeJS.ErrnoException).code === "ENOSPC") {
        throw new DriveError("The drive filled up during the upload.", 507);
      }
      throw err;
    }
    const final = uniqueName(
      name,
      (n) => statSync(join(this.dir, n), { throwIfNoEntry: false }) !== undefined,
    );
    renameSync(tmp, join(this.dir, final));
    return final;
  }

  remove(rawName: string) {
    rmSync(this.file(rawName).path);
  }

  /** Deletes leftovers from uploads that were cut off (agent restart, closed tab). */
  cleanupTemp() {
    try {
      for (const e of readdirSync(this.dir)) {
        if (e.startsWith(TEMP_PREFIX)) rmSync(join(this.dir, e), { force: true });
      }
    } catch {
      // Storage not ready; check() reports it.
    }
  }
}
