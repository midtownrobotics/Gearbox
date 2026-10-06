import { appUrl } from "@g3/site-config";
import type { OrdersApp } from "@g3/worker-orders";
import { hc } from "hono/client";

export const api = hc<OrdersApp>(import.meta.env.VITE_API_BASE_URL ?? "", {
  init: { credentials: "include" },
});

export function g3idUrl(): string {
  // The page's team's G3ID (the dev gateway's in dev).
  return appUrl("id");
}

/** Send the user to g3id login, returning here afterwards. */
export function redirectToLogin(): void {
  const redirect = encodeURIComponent(window.location.href);
  window.location.href = `${g3idUrl()}/login?redirect=${redirect}`;
}

export async function getErrorMessage(res: {
  status: number;
  json(): Promise<unknown>;
}): Promise<string> {
  if (res.status === 401) {
    redirectToLogin();
    return "Redirecting to login...";
  }
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {}
  return `Request failed (${res.status}).`;
}
