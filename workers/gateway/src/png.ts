// Just enough PNG to recolor an app icon: 8-bit RGB or RGBA, not interlaced (how every icon in
// apps/*/public is saved). Anything else is left alone by the caller.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

type Chunk = { type: string; data: Uint8Array };

export type Pixels = {
  width: number;
  height: number;
  /** 3 (RGB) or 4 (RGBA). */
  channels: 3 | 4;
  /** Row after row, `channels` bytes a pixel. */
  data: Uint8Array;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function chunks(png: Uint8Array): Chunk[] | null {
  if (png.length < 8 || SIGNATURE.some((byte, i) => png[i] !== byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const found: Chunk[] = [];
  let at = 8;
  while (at + 12 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (at + 12 + length > png.length) return null;
    found.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
    if (type === "IEND") return found;
  }
  return null;
}

/** The PNG's pixels, or null for a PNG this can't read. */
export async function decodePng(
  png: Uint8Array,
): Promise<{ pixels: Pixels; chunks: Chunk[] } | null> {
  const all = chunks(png);
  const header = all?.[0];
  if (!all || header?.type !== "IHDR" || header.data.length !== 13) return null;
  const view = new DataView(header.data.buffer, header.data.byteOffset, 13);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const [depth, colorType, , , interlace] = header.data.subarray(8);
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) return null;
  const channels = colorType === 6 ? 4 : 3;

  const idat = all.filter((chunk) => chunk.type === "IDAT");
  const joined = new Uint8Array(idat.reduce((sum, chunk) => sum + chunk.data.length, 0));
  let offset = 0;
  for (const chunk of idat) {
    joined.set(chunk.data, offset);
    offset += chunk.data.length;
  }
  let raw: Uint8Array;
  try {
    raw = await through(joined, new DecompressionStream("deflate"));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return null;

  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? data[row + x - channels] : 0;
      const up = y > 0 ? data[row - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? data[row - stride + x - channels] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = line[x];
          break;
        case 1:
          value = line[x] + left;
          break;
        case 2:
          value = line[x] + up;
          break;
        case 3:
          value = line[x] + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value = line[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          return null;
      }
      data[row + x] = value & 0xff;
    }
  }
  return { pixels: { width, height, channels, data }, chunks: all };
}

function chunkBytes(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * A PNG of `pixels`, keeping the original's other chunks (color profile, gamma) as they were. With
 * no original, just the header and the pixels.
 */
export async function encodePng(pixels: Pixels, original: Chunk[] = []): Promise<Uint8Array> {
  const { width, height, channels, data } = pixels;
  const stride = width * channels;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++)
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const idat = await through(raw, new CompressionStream("deflate"));

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8);

  const parts: Uint8Array[] = [new Uint8Array(SIGNATURE), chunkBytes("IHDR", header)];
  let wroteData = false;
  for (const chunk of original) {
    if (chunk.type === "IHDR" || chunk.type === "IEND") continue;
    if (chunk.type === "IDAT") {
      if (!wroteData) parts.push(chunkBytes("IDAT", idat));
      wroteData = true;
      continue;
    }
    parts.push(chunkBytes(chunk.type, chunk.data));
  }
  if (!wroteData) parts.push(chunkBytes("IDAT", idat));
  parts.push(chunkBytes("IEND", new Uint8Array()));

  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
