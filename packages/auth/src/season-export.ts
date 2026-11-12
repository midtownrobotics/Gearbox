// SPDX-License-Identifier: AGPL-3.0-only
/** Portable contracts; safe to import in a page without the worker/auth runtime. */
export type SeasonItem = {
  key: string;
  label: string;
  kind: string;
  year: number | null;
  records: number;
  files: number;
};
export type SeasonPlan = { year: number; items: SeasonItem[]; notes: string[] };
export type SeasonResetResult = { removed: number; kept: number; filesRemoved: number };
export type SeasonExport = {
  id: string;
  year: number;
  expiresAt: number;
  parts: {
    index: number;
    records: number;
    files: number;
    bytes: number;
    archiveHash: string | null;
    archiveSize: number | null;
    result: SeasonResetResult | null;
  }[];
};

export const SEASON_ARCHIVE_BYTES = 64 * 1024 ** 2;
export const validSeasonYear = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1992 && value <= 2200;

/** Sort object keys so database projections and JSON round trips have the same digest. */
export function seasonJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(seasonJSON).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${seasonJSON(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const digestHex = (digest: ArrayBuffer) =>
  Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
export async function seasonHash(value: unknown) {
  return digestHex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seasonJSON(value))),
  );
}

/** Check the saved file, rather than treating a download click as a completed backup. */
export async function verifySeasonBackup(file: Blob, hash: string, bytes: number) {
  if (file.size !== bytes || bytes > SEASON_ARCHIVE_BYTES + 4 * 1024 ** 2) return false;
  return digestHex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())) === hash;
}
