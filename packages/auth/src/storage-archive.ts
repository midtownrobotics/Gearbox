// SPDX-License-Identifier: AGPL-3.0-only
import type { StorageFile } from "./storage-report";

/** Stream a portable tar archive without buffering or compressing the team's files. */
export async function storageArchive(
  bucket: R2Bucket,
  files: StorageFile[],
  filename: string,
  assets: { name: string; bytes: Uint8Array }[] = [],
) {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(files[0]?.key ?? filename));
  const archiveId = Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  function header(name: string, size: number, time: number) {
    const block = new Uint8Array(512);
    const put = (offset: number, value: string) => block.set(encoder.encode(value), offset);
    const octal = (n: number, width: number) =>
      `${Math.floor(n)
        .toString(8)
        .padStart(width - 1, "0")}\0`;
    put(0, name);
    put(100, "0000644\0");
    put(108, "0000000\0");
    put(116, "0000000\0");
    put(124, octal(size, 12));
    put(136, octal(Math.max(0, time / 1000), 12));
    put(148, "        ");
    put(156, "0");
    put(257, "ustar\0");
    put(263, "00");
    put(
      148,
      `${block
        .reduce((n, b) => n + b, 0)
        .toString(8)
        .padStart(6, "0")}\0 `,
    );
    return block;
  }
  const padding = (size: number) => new Uint8Array((512 - (size % 512)) % 512);
  async function* archive() {
    const manifest: {
      name: string;
      archiveName: string;
      uploadedAt: number | null;
      eligible: boolean;
    }[] = [];
    for (const [index, file] of files.entries()) {
      const object = await bucket.get(file.key);
      if (!object)
        throw new Error("A file changed during download. Refresh Storage and try again.");
      const base = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-65) || "file";
      const suffix =
        object.httpMetadata?.contentEncoding === "gzip" && !base.endsWith(".gz") ? ".gz" : "";
      const name = `${archiveId}-${index + 1}-${base}${suffix}`;
      manifest.push({
        name: file.name,
        archiveName: name,
        uploadedAt: file.uploadedAt,
        eligible: file.eligible,
      });
      yield header(name, object.size, file.uploadedAt ?? 0);
      const reader = object.body.getReader();
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          yield part.value;
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      yield padding(object.size);
    }
    for (const asset of assets) {
      yield header(asset.name, asset.bytes.length, Date.now());
      yield asset.bytes;
      yield padding(asset.bytes.length);
    }
    const json = encoder.encode(
      JSON.stringify(
        {
          files: manifest,
          assets: assets.map((asset) => asset.name),
          note: "Files are stored bytes. Unzip .gz files before opening their contents.",
        },
        null,
        2,
      ),
    );
    yield header("manifest.json", json.length, Date.now());
    yield json;
    yield padding(json.length);
    yield new Uint8Array(1024);
  }
  const iterator = archive();
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await iterator.return(undefined);
      },
    }),
    {
      headers: {
        "Content-Type": "application/x-tar",
        "Content-Disposition": `attachment; filename="${filename}-${archiveId}.tar"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
