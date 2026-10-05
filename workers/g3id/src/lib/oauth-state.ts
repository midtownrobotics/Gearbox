import { teamKey } from "@g3/site-config";

// What a sign-in remembers across the trip to a provider and back. Sign-in starts on the team's
// G3ID host and the provider calls back on the platform's id.<domain> host, so the callback learns
// the team (and where to go next) from here. Each provider keeps it in its own state: in KV under
// a random key, or signed (GitHub).

export type OAuthState = {
  /** The team being signed in to. */
  team: string;
  /** Where to go once signed in (checked by sanitizeRedirect when the sign-in started). */
  redirect: string | null;
  /** Set when a signed-in user is linking this provider to their account. */
  linkUserId: string | null;
};

export function encodeState(state: OAuthState): string {
  return JSON.stringify(state);
}

export function decodeState(value: string): OAuthState {
  if (value.startsWith("{")) return JSON.parse(value) as OAuthState;
  // Started before teams (at most 10 minutes old): "signin", "signin:<redirect>", "link:<user id>".
  if (value.startsWith("link:"))
    return { team: teamKey, redirect: null, linkUserId: value.slice(5) };
  const redirect = value.startsWith("signin:") ? value.slice(7) : null;
  return { team: teamKey, redirect, linkUserId: null };
}
