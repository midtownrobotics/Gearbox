// SPDX-License-Identifier: AGPL-3.0-only
import type { StorageFile } from "./storage-report";

export type StorageArchivePart = { from: string; to: string; count: number; bytes: number };
/** Bound each request's file reads and archive size without buffering any file contents. */
export function storageArchiveParts(files: StorageFile[]): StorageArchivePart[] {
  const parts: StorageArchivePart[] = [];
  for (const file of [...files].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    let part = parts[parts.length - 1];
    if (!part || part.count >= 1000 || part.bytes + file.bytes > 512 * 1024 ** 2) {
      part = { from: file.key, to: file.key, count: 0, bytes: 0 };
      parts.push(part);
    }
    part.to = file.key;
    part.count++;
    part.bytes += file.bytes;
  }
  return parts;
}

export function storageArchiveSelection(files: StorageFile[], from?: string, to?: string) {
  const range = files.filter((file) => (!from || file.key >= from) && (!to || file.key <= to));
  const part = storageArchiveParts(range)[0];
  return part
    ? range
        .filter((file) => file.key >= part.from && file.key <= part.to)
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    : [];
}
