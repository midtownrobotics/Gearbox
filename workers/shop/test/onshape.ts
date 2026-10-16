import { call } from "@g3/testing/worker";

/** An Onshape webhook event, signed with `key` as Onshape signs them, on a team's address. */
export async function onshapeEvent(teamId: string, key: string, body: unknown) {
  const raw = JSON.stringify(body);
  const timestamp = String(Date.now());
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${timestamp}.${raw}`),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return call("/onshape/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Team-Id": teamId,
      "X-onshape-webhook-timestamp": timestamp,
      "X-onshape-webhook-signature-primary": signature,
      "X-onshape-webhook-signature-secondary": signature,
    },
    body: raw,
  });
}

/** Waits for work done after the answer (waitUntil) to show up. */
export async function eventually<T>(check: () => Promise<T | null | undefined>, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting");
}
