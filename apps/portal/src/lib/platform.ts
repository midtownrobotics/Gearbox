import { apiPath } from "@g3/site-config";

// The platform's API for the team's own pages (workers/platform/src/team.ts), through the
// gateway's /api/~platform, which says which team it's for.

export type TeamApp = { slug: string; name: string; summary: string };

export type LibraryApp = TeamApp & {
  integrations: string[];
  version: string;
  enabled: boolean;
  changedAt: number | null;
  changedBy: string | null;
  /** Switched off: when its data is deleted (null if the app keeps it). */
  deleteAfter: number | null;
  /** Switched off and its data already deleted. */
  dataDeleted: boolean;
  keepsDataWhenOff: boolean;
};

export type LogEntry = {
  id: string;
  action: "app_enabled" | "app_disabled" | "app_data_deleted";
  app: string | null;
  appName: string | null;
  userName: string | null;
  details: Record<string, unknown>;
  createdAt: number;
};

export async function platform<T>(path: string, init?: { method: string; body?: unknown }) {
  const res = await fetch(`${apiPath("platform")}${path}`, {
    method: init?.method ?? "GET",
    credentials: "include",
    headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data as T;
}
