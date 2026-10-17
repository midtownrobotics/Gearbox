// Reading a zip someone uploaded (AdvantageScope assets, ./advantagescope.ts): the entries from its
// central directory, each read when it's needed, stored or deflated (the runtime's
// DecompressionStream). No Zip64 and no encryption: an asset zip is well under 4 GiB.

export type ZipEntry = {
  /** The path inside the zip, "/" between folders ("Robot_Comet/model.glb"). */
  path: string;
  /** Unzipped bytes, as the zip says. */
  size: number;
  read(): Promise<Uint8Array<ArrayBuffer>>;
};

export class ZipError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** The zip's files (not its folders). Throws ZipError when it isn't a zip this can read. */
export function readZip(bytes: Uint8Array<ArrayBuffer>): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);

  // The end of central directory record: the last 22 bytes, or before a comment of up to 64 KiB.
  let end = -1;
  for (let at = bytes.length - 22; at >= 0 && at >= bytes.length - 22 - 0xffff; at--) {
    if (u32(at) === EOCD) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new ZipError("Not a zip file.");
  const count = u16(end + 10);
  let at = u32(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new ZipError("The zip is too large.");

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(at) !== CENTRAL) throw new ZipError("The zip is damaged.");
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const compressed = u32(at + 20);
    const size = u32(at + 24);
    const nameLength = u16(at + 28);
    const local = u32(at + 42);
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + u16(at + 30) + u16(at + 32);

    if (path.endsWith("/")) continue;
    if (flags & 1) throw new ZipError("The zip is encrypted.");
    if (method !== 0 && method !== 8)
      throw new ZipError("The zip uses a compression it can't read.");
    if (local + 30 > bytes.length || u32(local) !== LOCAL)
      throw new ZipError("The zip is damaged.");
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + compressed > bytes.length) throw new ZipError("The zip is damaged.");
    const data = bytes.subarray(start, start + compressed);

    entries.push({
      path,
      size,
      // Never more than the zip says: a file can't unzip past its stated size.
      async read() {
        if (method === 0) {
          if (data.length !== size) throw new ZipError("The zip is damaged.");
          return data;
        }
        const reader = new Blob([data])
          .stream()
          .pipeThrough(new DecompressionStream("deflate-raw"))
          .getReader();
        const out = new Uint8Array(size);
        let length = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (length + value.length > size) {
            await reader.cancel();
            throw new ZipError("The zip is damaged.");
          }
          out.set(value, length);
          length += value.length;
        }
        if (length !== size) throw new ZipError("The zip is damaged.");
        return out;
      },
    });
  }
  return entries;
}
