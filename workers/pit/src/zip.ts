// A zip of gzipped files, streamed without unzipping or zipping anything again. A gzip file is a
// deflate stream between a 10-byte header and an 8-byte trailer holding the CRC-32 and the
// unzipped size, and a zip entry is a deflate stream with those in its headers: so each file goes
// from R2 into the zip as it is, and the worker spends no CPU on compression or checksums.
// Sizes stay under 4 GiB (no Zip64): Pit keeps at most 20 logs of 40 MiB each.

const GZIP_HEADER = 10;
const GZIP_TRAILER = 8;

export type ZipSource = {
  /** The name inside the zip ("archimedes/Qual-13.wpilog"). */
  name: string;
  /** The gzipped file's key and size in the bucket. */
  key: string;
  size: number;
  modified: Date;
};

function dosTime(date: Date) {
  return (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
}

function dosDate(date: Date) {
  return (
    ((Math.max(date.getUTCFullYear(), 1980) - 1980) << 9) |
    ((date.getUTCMonth() + 1) << 5) |
    date.getUTCDate()
  );
}

/** The zip's size, from the gzipped files' sizes (for Content-Length). */
export function zipSize(files: ZipSource[]) {
  const encoder = new TextEncoder();
  let total = 22;
  for (const file of files) {
    const name = encoder.encode(file.name).length;
    total += 30 + name + (file.size - GZIP_HEADER - GZIP_TRAILER) + 46 + name;
  }
  return total;
}

/**
 * Streams the files as one zip into `writable`. Each must be a gzip with the plain 10-byte header
 * Node's zlib writes; one that isn't, or is missing, fails the zip.
 */
export async function writeZip(bucket: R2Bucket, files: ZipSource[], writable: WritableStream) {
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const central: Uint8Array[] = [];
  let offset = 0;
  const write = async (bytes: Uint8Array) => {
    await writer.write(bytes);
    offset += bytes.length;
  };

  try {
    for (const file of files) {
      const head = await bucket.get(file.key, { range: { offset: 0, length: GZIP_HEADER } });
      const tail = await bucket.get(file.key, { range: { suffix: GZIP_TRAILER } });
      if (!head || !tail) throw new Error(`Missing ${file.key}`);
      const h = new Uint8Array(await head.arrayBuffer());
      if (h[0] !== 0x1f || h[1] !== 0x8b || h[2] !== 8 || h[3] !== 0) {
        throw new Error(`Not a plain gzip: ${file.key}`);
      }
      const t = new DataView(await tail.arrayBuffer());
      const crc = t.getUint32(0, true);
      const rawSize = t.getUint32(4, true);
      const deflated = file.size - GZIP_HEADER - GZIP_TRAILER;
      const name = encoder.encode(file.name);
      const time = dosTime(file.modified);
      const date = dosDate(file.modified);
      const start = offset;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 8, true); // deflate
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, deflated, true);
      local.setUint32(22, rawSize, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      await write(new Uint8Array(local.buffer));
      await write(name);

      const body = await bucket.get(file.key, { range: { offset: GZIP_HEADER, length: deflated } });
      if (!body) throw new Error(`Missing ${file.key}`);
      const reader = body.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await write(value);
      }

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true); // made by
      entry.setUint16(6, 20, true); // needed
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, 8, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, deflated, true);
      entry.setUint32(24, rawSize, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, start, true);
      central.push(new Uint8Array(entry.buffer), name);
    }

    const centralStart = offset;
    for (const part of central) await write(part);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, offset - centralStart, true);
    end.setUint32(16, centralStart, true);
    await write(new Uint8Array(end.buffer));
    await writer.close();
  } catch (err) {
    await writer.abort(err);
    throw err;
  }
}
