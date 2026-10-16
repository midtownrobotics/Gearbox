// WPILib data logs (.wpilog, format 1.0): what's in a log over time, and trimming one to part of
// it. A log is a header, then records: a byte of field lengths, the entry id, the payload size and
// the timestamp (microseconds), then the payload. Entry 0 is control: starting an entry (its id,
// name and type), finishing it, or setting its metadata.

const MAGIC = "WPILOG";

type Record = {
  /** Where the record starts and ends in the log. */
  start: number;
  end: number;
  entry: number;
  timestamp: number;
  payload: Buffer;
};

/** A little-endian unsigned integer of up to 8 bytes (timestamps fit in a double). */
function readUInt(buf: Buffer, at: number, length: number) {
  let value = 0;
  for (let i = length - 1; i >= 0; i--) value = value * 256 + buf[at + i];
  return value;
}

function bytesFor(value: number, max: number) {
  let n = 1;
  while (n < max && value >= 256 ** n) n++;
  return n;
}

function writeUInt(value: number, length: number) {
  const out = Buffer.alloc(length);
  let v = value;
  for (let i = 0; i < length; i++) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

function headerLength(buf: Buffer) {
  if (buf.subarray(0, 6).toString("latin1") !== MAGIC) throw new Error("Not a .wpilog file.");
  return 12 + buf.readUInt32LE(8);
}

function* records(buf: Buffer): Generator<Record> {
  let pos = headerLength(buf);
  while (pos < buf.length) {
    const start = pos;
    const lengths = buf[pos++];
    const idLength = (lengths & 3) + 1;
    const sizeLength = ((lengths >> 2) & 3) + 1;
    const timeLength = ((lengths >> 4) & 7) + 1;
    if (pos + idLength + sizeLength + timeLength > buf.length) return;
    const entry = readUInt(buf, pos, idLength);
    pos += idLength;
    const size = readUInt(buf, pos, sizeLength);
    pos += sizeLength;
    const timestamp = readUInt(buf, pos, timeLength);
    pos += timeLength;
    if (pos + size > buf.length) return; // Cut off mid-record (the robot lost power).
    yield { start, end: pos + size, entry, timestamp, payload: buf.subarray(pos, pos + size) };
    pos += size;
  }
}

function encodeRecord(entry: number, timestamp: number, payload: Buffer) {
  const idLength = bytesFor(entry, 4);
  const sizeLength = bytesFor(payload.length, 4);
  const timeLength = bytesFor(timestamp, 8);
  return Buffer.concat([
    Buffer.from([(idLength - 1) | ((sizeLength - 1) << 2) | ((timeLength - 1) << 4)]),
    writeUInt(entry, idLength),
    writeUInt(payload.length, sizeLength),
    writeUInt(timestamp, timeLength),
    payload,
  ]);
}

/** The name an entry-start control record gives its entry, with its id. */
function startedEntry(payload: Buffer) {
  if (payload[0] !== 0 || payload.length < 9) return null;
  const id = payload.readUInt32LE(1);
  const nameLength = payload.readUInt32LE(5);
  return { id, name: payload.subarray(9, 9 + nameLength).toString("utf8") };
}

/** What a log holds over time, for choosing what to keep. Seconds count from its first record. */
export type Timeline = {
  /** The first record's timestamp, microseconds. */
  startUs: number;
  /** Seconds from the first record to the last. */
  duration: number;
  /** The log's bytes in each second. */
  bytesPerSecond: number[];
  /** When the robot was enabled, [from, to] in seconds (AdvantageKit's /DriverStation/Enabled). */
  enabled: [number, number][];
  /** When it was in autonomous while enabled. */
  autonomous: [number, number][];
  /** From a little before the first enable to a little after the last disable; null if never enabled. */
  suggested: [number, number] | null;
};

/** How much to keep around the enabled time in a suggested trim. */
const SUGGESTED_MARGIN = 15;

export function timeline(buf: Buffer): Timeline {
  const names = new Map<number, string>();
  const bytes: number[] = [];
  const spans = { enabled: [] as [number, number][], autonomous: [] as [number, number][] };
  const on = { enabled: null as number | null, autonomous: null as number | null };
  let first: number | null = null;
  let last = 0;

  for (const record of records(buf)) {
    if (record.entry === 0) {
      const started = startedEntry(record.payload);
      if (started) names.set(started.id, started.name);
      continue;
    }
    first ??= record.timestamp;
    const second = Math.max(0, Math.floor((record.timestamp - first) / 1e6));
    bytes[second] = (bytes[second] ?? 0) + (record.end - record.start);
    last = Math.max(last, record.timestamp);

    const name = names.get(record.entry);
    const key =
      name === "/DriverStation/Enabled"
        ? "enabled"
        : name === "/DriverStation/Autonomous"
          ? "autonomous"
          : null;
    if (key && record.payload.length >= 1) {
      const at = (record.timestamp - first) / 1e6;
      if (record.payload[0] && on[key] === null) on[key] = at;
      if (!record.payload[0] && on[key] !== null) {
        spans[key].push([on[key] as number, at]);
        on[key] = null;
      }
    }
  }

  const startUs = first ?? 0;
  const duration = first === null ? 0 : (last - first) / 1e6;
  for (const key of ["enabled", "autonomous"] as const) {
    if (on[key] !== null) spans[key].push([on[key] as number, duration]);
  }
  // Autonomous counts only while enabled (the flag is set before the match too).
  const autonomous = spans.autonomous.filter(([from, to]) =>
    spans.enabled.some(([a, b]) => from < b && to > a),
  );
  const enabled = spans.enabled;
  const suggested: [number, number] | null = enabled.length
    ? [
        Math.max(0, enabled[0][0] - SUGGESTED_MARGIN),
        Math.min(duration, enabled[enabled.length - 1][1] + SUGGESTED_MARGIN),
      ]
    : null;
  return {
    startUs,
    duration,
    bytesPerSecond: Array.from(bytes, (b) => b ?? 0),
    enabled,
    autonomous,
    suggested,
  };
}

/**
 * The log cut to [fromUs, toUs]: every entry is still started, and each starts the kept part with
 * the last value it had before it, so nothing reads blank at the start.
 */
export function trim(buf: Buffer, fromUs: number, toUs: number): Buffer {
  const out: Buffer[] = [buf.subarray(0, headerLength(buf))];
  const lastBefore = new Map<number, Buffer>();
  let flushed = false;
  const flush = () => {
    for (const [entry, payload] of lastBefore) out.push(encodeRecord(entry, fromUs, payload));
    lastBefore.clear();
    flushed = true;
  };

  for (const record of records(buf)) {
    if (record.entry === 0) {
      // Starting entries and their metadata, before the end. A finish before the start drops the
      // value held for it.
      if (record.timestamp > toUs) continue;
      if (record.payload[0] === 1 && record.timestamp < fromUs && record.payload.length >= 5) {
        lastBefore.delete(record.payload.readUInt32LE(1));
      }
      out.push(buf.subarray(record.start, record.end));
      continue;
    }
    if (record.timestamp < fromUs) {
      lastBefore.set(record.entry, record.payload);
    } else if (record.timestamp <= toUs) {
      if (!flushed) flush();
      out.push(buf.subarray(record.start, record.end));
    }
  }
  if (!flushed) flush();
  return Buffer.concat(out);
}
