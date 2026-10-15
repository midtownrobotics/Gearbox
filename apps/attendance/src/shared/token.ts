export type PageType = "signin" | "signout";

export const WINDOW_MS = 30_000;

export function currentWindow(): number {
  return Math.floor(Date.now() / WINDOW_MS);
}

export function msUntilNextWindow(): number {
  return WINDOW_MS - (Date.now() % WINDOW_MS);
}

/** URL encoded into the QR code — scanned by the member's phone. */
export function buildQrUrl(type: PageType): string {
  const origin = window.location.origin;
  return `${origin}/?action=${type}&w=${currentWindow()}`;
}
