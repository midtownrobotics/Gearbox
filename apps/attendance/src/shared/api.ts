// SPDX-License-Identifier: AGPL-3.0-only
import { redirectToSignIn } from "@g3/ui";
export const API = (import.meta.env.VITE_API_URL as string) || "/api";

export type Me = {
  id: string;
  displayName: string;
  email: string;
  isAdmin: boolean;
};

/** Off to the team's ID sign-in page, coming back here (the same for every app). */
export function redirectToLogin(): void {
  redirectToSignIn();
}
