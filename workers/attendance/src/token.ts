// SPDX-License-Identifier: AGPL-3.0-only
const WINDOW_MS = 30_000;
const VALID_WINDOWS = 4; // 4 x 30s = 2 minutes

export function currentWindow(): number {
  return Math.floor(Date.now() / WINDOW_MS);
}

// Proof of presence: the kiosk shows a QR encoding the current 30s window `w`.
// A scan is only accepted within VALID_WINDOWS of the live code. Validation
// happens here so a member's phone clock cannot reject a fresh server-issued QR.
export function validateToken(w: number): void {
  if (!Number.isSafeInteger(w) || w < 0) throw new Error("TOKEN_EXPIRED");
  const current = currentWindow();
  if (w > current) throw new Error("TOKEN_EXPIRED");
  if (current - w > VALID_WINDOWS) throw new Error("TOKEN_EXPIRED");
}
