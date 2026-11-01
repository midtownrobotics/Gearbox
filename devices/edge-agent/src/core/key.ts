// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time check of an `Authorization: Bearer <key>` header against the shared key. */
export function bearerMatches(header: string | undefined, key: string) {
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!provided || !key) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(provided), digest(key));
}
