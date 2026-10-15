import { redirectToSignIn } from "@g3/ui";
import { isKioskDevice, redirectToKioskLogin } from "./kiosk";

/** Send the user to g3id login, preserving where they were so they return after auth.
 * Kiosk devices go to the PIN pad instead of the normal login page. */
export function redirectToLogin(): void {
  if (isKioskDevice()) {
    redirectToKioskLogin();
    return;
  }
  redirectToSignIn();
}

export async function getErrorMessage(res: Response): Promise<string> {
  if ((res.status as number) === 401) {
    redirectToLogin();
    return "Redirecting to sign in…";
  }
  try {
    const body = (await res.clone().json()) as { error?: string };
    if (body.error) return body.error;
  } catch {}
  return `Request failed (${res.status}).`;
}
