import { appUrl } from "@g3/site-config";

// Every app sends a signed-out visitor to its team's ID sign-in page the moment it knows nobody is
// signed in (never just because it's offline), coming back to the page they were on afterward.

/** The team's ID sign-in page, returning to `returnTo` (the page that's open) afterward. */
export function signInUrl(returnTo = window.location.href): string {
  return `${appUrl("id")}/login?redirect=${encodeURIComponent(returnTo)}`;
}

/** Off to sign in, replacing this page in the history so Back doesn't bounce here again. */
export function redirectToSignIn(returnTo?: string): void {
  window.location.replace(signInUrl(returnTo));
}
