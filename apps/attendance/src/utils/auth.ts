import { appUrl } from "@g3/site-config";
export const API = (import.meta.env.VITE_API_URL as string) || "/api";
export const G3ID_WEB = appUrl("id");

export type Me = {
  id: string;
  displayName: string;
  email: string;
  isAdmin: boolean;
};

// Send the browser to the G3ID login page, returning here afterward.
export function redirectToLogin(): void {
  window.location.href = `${G3ID_WEB}/login?redirect=${encodeURIComponent(window.location.href)}`;
}
