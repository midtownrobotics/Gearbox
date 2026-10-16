import { redirectToSignIn } from "@g3/ui";
import type { InventoryApp } from "@g3/worker-inventory";
import { hc } from "hono/client";

export const api = hc<InventoryApp>(import.meta.env.VITE_API_BASE_URL ?? "", {
  init: { credentials: "include" },
});

/** Off to the team's ID sign-in page, coming back here (the same for every app). */
export function redirectToLogin(): void {
  redirectToSignIn();
}

export async function getErrorMessage(res: {
  status: number;
  json(): Promise<unknown>;
}): Promise<string> {
  if (res.status === 401) {
    redirectToLogin();
    return "Redirecting to sign in…";
  }
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {}
  return `Request failed (${res.status}).`;
}
