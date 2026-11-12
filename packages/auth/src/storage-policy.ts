// SPDX-License-Identifier: AGPL-3.0-only
export type StorageCleanupMode = "delete-oldest" | "block-uploads" | "unavailable";

/** Never cache permission to delete: an unavailable policy always preserves existing files. */
export async function teamStorageMode(
  env: { G3ID: Fetcher },
  teamId: string,
): Promise<StorageCleanupMode> {
  try {
    const response = await env.G3ID.fetch(
      `http://g3id/api/internal/teams/${encodeURIComponent(teamId)}/storage-policy`,
    );
    if (!response.ok) return "unavailable";
    const policy = (await response.json()) as { automaticDeletion?: unknown };
    if (typeof policy.automaticDeletion !== "boolean") return "unavailable";
    return policy.automaticDeletion ? "delete-oldest" : "block-uploads";
  } catch {
    return "unavailable";
  }
}
