// SPDX-License-Identifier: AGPL-3.0-only
import { storageRetentionCutoff } from "./storage-limit";
import type { StorageCleanupMode } from "./storage-policy";

export type StorageFile = {
  key: string;
  name: string;
  bytes: number;
  uploadedAt: number | null;
  eligible: boolean;
  eligibleAfter?: number | null;
};
export type StorageAllowance = {
  id: string;
  name: string;
  bytes: number;
  byteLimit: number | null;
  count: number;
  countLimit: number;
  countLabel: string;
  cleanupEnabled?: boolean;
  cleanupConfigured?: boolean;
  files: StorageFile[];
};
export type StorageReport = {
  checkedAt: number;
  cutoff: number;
  cleanupMode?: StorageCleanupMode;
  allowances: StorageAllowance[];
};

/** First instant at which the six-month cutoff is strictly after this upload. */
export function storageEligibleAfter(uploaded: number): number | null {
  if (!Number.isFinite(uploaded) || uploaded <= 0) return null;
  const date = new Date(uploaded);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 6);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  if (day > end) {
    date.setUTCMonth(date.getUTCMonth() + 1);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
  }
  date.setUTCDate(day);
  return date.getTime() + 1;
}

export async function listStorageObjects(bucket: R2Bucket, prefix: string): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

export function storageFile(object: R2Object, prefix: string, _now = Date.now()): StorageFile {
  const time = object.uploaded.getTime();
  return {
    key: object.key,
    name: object.key.slice(prefix.length),
    bytes: object.size,
    uploadedAt: Number.isFinite(time) && time > 0 ? time : null,
    eligible: true,
    eligibleAfter: null,
  };
}

export async function bucketStorageReport(
  bucket: R2Bucket,
  prefix: string,
  name: string,
  limit: { bytes: number; objects: number },
  mode: StorageCleanupMode = "delete-oldest",
): Promise<StorageReport> {
  const checkedAt = Date.now();
  const files = (await listStorageObjects(bucket, prefix)).map((o) => ({
    ...storageFile(o, prefix, checkedAt),
    eligible: mode === "delete-oldest",
  }));
  return {
    checkedAt,
    cutoff: storageRetentionCutoff(checkedAt),
    cleanupMode: mode,
    allowances: [
      {
        id: "files",
        name,
        bytes: files.reduce((n, f) => n + f.bytes, 0),
        byteLimit: limit.bytes,
        count: files.length,
        countLimit: limit.objects,
        countLabel: "files",
        cleanupEnabled: mode === "delete-oldest",
        files,
      },
    ],
  };
}

/** Service-binding hook; the platform authenticates the team's admin. */
export async function downloadStorageFile(
  bucket: R2Bucket,
  prefix: string,
  key: string,
  view?: (object: R2ObjectBody) => Promise<Response | undefined>,
) {
  if (!key.startsWith(prefix) || key === prefix)
    return new Response("File not found.", { status: 404 });
  const object = await bucket.get(key);
  if (!object) return new Response("File not found.", { status: 404 });
  const rendered = await view?.(object);
  if (rendered) return rendered;
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  // Keep stored gzip bytes intact, with a .gz name, rather than silently decoding an archive.
  const parts = key.slice(prefix.length).split("/");
  const name = parts[parts.length - 1] || "file";
  const filename =
    object.httpMetadata?.contentEncoding === "gzip" && !name.endsWith(".gz") ? `${name}.gz` : name;
  headers.set("Content-Type", "application/octet-stream");
  headers.set(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  return new Response(object.body, { headers });
}
