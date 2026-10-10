import { type AppName, apiPath } from "@g3/site-config";

// The platform's API for the team's own pages (workers/platform/src/team.ts), through the
// gateway's /api/~platform, which says which team it's for.

export type TeamApp = { slug: string; name: string; summary: string };

/** Whether an integration is connected, and what there is to know about it (@g3/auth). */
export type IntegrationStatus = {
  connected: boolean;
  detail?: string;
  facts?: { label: string; value?: string; at?: number }[];
};

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
  /** Its data can be downloaded (offered before switching it off). */
  exportable: boolean;
};

export type LogEntry = {
  id: string;
  action: "app_enabled" | "app_disabled" | "app_data_deleted" | "app_exported" | "settings_changed";
  app: string | null;
  appName: string | null;
  userName: string | null;
  details: Record<string, unknown>;
  createdAt: number;
};

/** Downloads an app's data for the team as a JSON file (the platform's export, logged there). */
export async function downloadAppData(slug: string) {
  const res = await fetch(
    `${apiPath("platform")}/team/library/${encodeURIComponent(slug)}/export`,
    {
      credentials: "include",
    },
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Couldn't download its data. Please try again.");
  }
  const name =
    res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `${slug}.json`;
  const url = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

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

/**
 * What an app knows about the integrations it connects (its own /team-settings, through the
 * gateway's /api/~<app>), by integration.
 */
export async function appIntegrations(slug: string): Promise<Record<string, IntegrationStatus>> {
  const res = await fetch(`${apiPath(slug as AppName)}/team-settings`, { credentials: "include" });
  const data = (await res.json().catch(() => ({}))) as {
    integrations?: Record<string, IntegrationStatus>;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "Couldn't ask it. Please try again.");
  return data.integrations ?? {};
}
