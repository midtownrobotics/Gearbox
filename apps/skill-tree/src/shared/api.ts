import type { SkillTreeApp } from "@g3/worker-skill-tree";
import { hc } from "hono/client";

export const api = hc<SkillTreeApp>(import.meta.env.VITE_API_BASE_URL ?? "", {
  init: { credentials: "include" },
});

export function g3idUrl(): string {
  return import.meta.env.VITE_G3ID_URL || "http://localhost:5173";
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
