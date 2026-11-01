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
  /** Not ready for other teams yet: a warning to show with it. */
  preview: string | null;
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

/** A time a Gearbox operator opened or changed the team (never which operator). */
export type OperatorAccess = {
  id: string;
  action: "view_team" | "transfer_owner" | "suspend_team" | "reactivate_team" | "renumber_team";
  reason: string | null;
  /** A handover's members. */
  from: string | null;
  to: string | null;
  createdAt: number;
};

/** A member's reporter ID: what stands for them on their problem reports' public issues. */
export type Reporter = {
  id: string;
  userId: string;
  blocked: boolean;
  blockedAt: number | null;
  blockReason: string | null;
};

/** The team's reporter IDs by member (admins only); empty when they can't be loaded. */
export async function reporterIds(): Promise<Map<string, Reporter>> {
  try {
    const list = await platform<Reporter[]>("/team/reports/reporters");
    return new Map(list.map((r) => [r.userId, r]));
  } catch {
    return new Map();
  }
}

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

export type NotificationType = "info" | "critical";
export type PortalAudience = "everyone" | "admins" | "nobody";

/** A notification, as the home page shows it: Gearbox's, or one of the team's admins wrote. */
export type TeamNotification = {
  id: string;
  type: NotificationType;
  summary: string;
  body: string;
  createdAt: number;
  expiresAt: number;
  fromTeam: boolean;
  /** Who wrote a team one; null for Gearbox's. */
  createdByName: string | null;
};

/** A notification the team's admins wrote, as their admin page lists it. */
export type WrittenNotification = {
  id: string;
  type: NotificationType;
  summary: string;
  body: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: number;
  expiresAt: number;
};

/** Whose notifications: Gearbox's operators', or the team's own admins'. */
export type NotificationSource = "gearbox" | "team";

export type NotificationTypeSettings = {
  portal: PortalAudience;
  /** A channel's id on the team's chat (Slack or Discord), or null. */
  channel: string | null;
  /** G3ID user ids, DMed on the team's chat: only Gearbox's Critical ones. */
  users: string[];
};

export type NotificationSettings = Record<
  NotificationSource,
  Record<NotificationType, NotificationTypeSettings>
>;

export type DmCandidate = { id: string; displayName: string; isAdmin: boolean; hasChat: boolean };

export const NOTIFICATION_TYPES: { type: NotificationType; label: string }[] = [
  { type: "critical", label: "Critical" },
  { type: "info", label: "Informational" },
];

/** Colors that mean the type: red for critical. */
export const NOTIFICATION_STYLES: Record<NotificationType, { badge: string; stripe: string }> = {
  info: { badge: "bg-secondary-100 text-secondary-700", stripe: "border-l-secondary-300" },
  critical: { badge: "bg-red-100 text-red-800", stripe: "border-l-red-600" },
};
