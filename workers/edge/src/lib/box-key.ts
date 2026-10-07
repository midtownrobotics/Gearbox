import { inTeam } from "@g3/auth";
import type { EdgeDb } from "../db";
import { edgeBoxes } from "../db/schema";

// Each team's box has its own key, made on the Edge app's Edge Box page (routes/box.ts) and shown
// once; only its SHA-256 is kept. The box sends it as `Authorization: Bearer <key>` on every
// request and when it opens its link, on its own team's address, so a key only ever opens its own
// team's link.

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export async function hashKey(key: string) {
  return toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))),
  );
}

/** A new box key: "edge_" and 43 random base64url characters. */
export function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `edge_${b64}`;
}

/** Constant-time comparison of two hex digests of equal length. */
function sameDigest(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Whether `key` is the team's box key. */
export async function isTeamBoxKey(db: EdgeDb, teamId: string, key: string) {
  if (!key) return false;
  const box = await db
    .select({ keyHash: edgeBoxes.keyHash })
    .from(edgeBoxes)
    .where(inTeam(edgeBoxes, teamId))
    .get();
  return Boolean(box && sameDigest(box.keyHash, await hashKey(key)));
}

/** The team's box, if it has one (never the key's hash). */
export function teamBox(db: EdgeDb, teamId: string) {
  return db
    .select({
      keyHint: edgeBoxes.keyHint,
      createdByName: edgeBoxes.createdByName,
      createdAt: edgeBoxes.createdAt,
    })
    .from(edgeBoxes)
    .where(inTeam(edgeBoxes, teamId))
    .get();
}
