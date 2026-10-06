import { appUrl } from "@g3/site-config";
import { api } from "./api";

/** localStorage flag marking this browser as a dedicated shop kiosk device. */
const KIOSK_FLAG = "shop_kiosk_mode";

export function g3idUrl(): string {
  // The page's team's G3ID (the dev gateway's in dev).
  return appUrl("id");
}

/** True when this device has been marked as a kiosk from the Admin page. */
export function isKioskDevice(): boolean {
  try {
    return localStorage.getItem(KIOSK_FLAG) === "1";
  } catch {
    return false;
  }
}

/** Send this device to the g3id kiosk flow (activate → PIN pad), returning here after. */
export function redirectToKioskLogin(): void {
  const redirect = encodeURIComponent(window.location.origin);
  window.location.href = `${g3idUrl()}/kiosk/login?redirect=${redirect}`;
}

/** Mark this device as a kiosk, end the current session, and start the g3id kiosk flow. */
export async function enableKioskMode(): Promise<void> {
  localStorage.setItem(KIOSK_FLAG, "1");
  try {
    await api.logout.$post();
  } catch {
    // Even if logout fails, continue into the kiosk flow.
  }
  redirectToKioskLogin();
}

/** Leave kiosk mode: clear the device flag, end the session, return to normal login. */
export async function exitKioskMode(): Promise<void> {
  localStorage.removeItem(KIOSK_FLAG);
  try {
    await api.logout.$post();
  } catch {
    // Ignore — we're leaving anyway.
  }
  const redirect = encodeURIComponent(window.location.origin);
  window.location.href = `${g3idUrl()}/login?redirect=${redirect}`;
}

/** Log the current user out of the kiosk and pull the PIN pad back up. */
export async function kioskLogout(): Promise<void> {
  try {
    await api.logout.$post();
  } catch {
    // Ignore — redirecting to the PIN pad regardless.
  }
  redirectToKioskLogin();
}
