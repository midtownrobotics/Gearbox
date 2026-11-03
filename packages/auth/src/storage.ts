// SPDX-License-Identifier: AGPL-3.0-only

// How much an app keeps in R2 for each team, for the operators' console's Teams page (an app's
// `storage` hook, GET /api/internal/storage). Counts only: never a file's name.

/** A team's files in one app: their total size and how many. */
export type TeamStorage = { bytes: number; objects: number };

/** What an app's storage hook answers: each team's files, by team id. */
export type StorageByTeam = { teams: Record<string, TeamStorage> };

/**
 * Adds up every object under `root` (e.g. "teams/") in a bucket, by the next part of its key: the
 * team's id, as written (`decode` for keys that encode it). Lists the whole prefix, 1,000 at a
 * time, into `into` (so an app with several prefixes or buckets adds them together).
 */
export async function storageByTeam(
  bucket: R2Bucket,
  root: string,
  into: Record<string, TeamStorage> = {},
  decode = false,
): Promise<Record<string, TeamStorage>> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: root, limit: 1000, cursor });
    for (const object of page.objects) {
      const part = object.key.slice(root.length).split("/")[0];
      if (!part) continue;
      const teamId = decode ? safeDecode(part) : part;
      into[teamId] ??= { bytes: 0, objects: 0 };
      const team = into[teamId];
      team.bytes += object.size;
      team.objects += 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return into;
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}
