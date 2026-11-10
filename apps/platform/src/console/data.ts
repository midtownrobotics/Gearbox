// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

// The console's data: its API (/api/console on the platform worker) and its types.

export const consoleApi = api.console;

/** A response's JSON, or its `error` thrown. */
export async function read<T>(
  response: Promise<{ ok: boolean; json(): Promise<unknown> }>,
): Promise<T> {
  const res = await response;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Something went wrong. Please try again.");
  return body as T;
}

/** A change through the console's API (`path` under /api/console), with a JSON body. */
export function send<T = unknown>(
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  return read<T>(
    fetch(`/api/console${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/** Loads `load()` now and on reload(); keeps the last result while reloading. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller lists what `load` uses.
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload };
}

/** The chat's name: "Slack", "Discord" or "—". */
export const chatName = (chat: "slack" | "discord" | null) =>
  chat === "discord" ? "Discord" : chat === "slack" ? "Slack" : "—";

export type TeamStatus = "pending" | "active" | "suspended";

export type TeamRow = {
  id: string;
  teamNumber: number;
  name: string;
  country: string;
  status: TeamStatus;
  /** Which chat it uses, never its workspace's or server's name. */
  chat: "slack" | "discord" | null;
  createdAt: number;
  openReports: number;
  /** Active members; null when ID couldn't say. */
  members: number | null;
  isSite: boolean;
};

/** How much each team keeps in R2, by team id, and the apps that didn't answer. */
export type Storage = {
  teams: Record<string, { bytes: number; objects: number; apps: Record<string, number> }>;
  failed: string[];
};

/** How many accounts a team has: counts only. */
export type MemberCounts = { active: number; admins: number; mentors: number; pending: number };

/** A team's member list, opened with a reason (logged, and shown to the team's admins). */
export type MemberList = {
  members: Member[];
  ownerUserId: string | null;
  founderUserId: string | null;
};

export type Member = {
  id: string;
  displayName: string;
  email: string;
  status: string;
  isAdmin: boolean;
  isMentor: boolean;
  lastLoginAt: number | null;
};

export type Report = {
  id: string;
  teamNumber: number;
  email: string;
  name: string | null;
  message: string;
  status: "open" | "resolved";
  createdAt: number;
  resolvedAt?: number | null;
  teamId?: string | null;
  teamName?: string | null;
  teamStatus?: TeamStatus | null;
};

export type Action = {
  id: string;
  operatorUserId: string;
  operatorName: string;
  action: string;
  teamId: string | null;
  reason: string | null;
  details: Record<string, unknown>;
  createdAt: number;
};

export type TeamDetail = {
  team: {
    id: string;
    teamNumber: number;
    name: string;
    country: string;
    status: TeamStatus;
    /** Which chat it uses, never its workspace's or server's name. */
    chat: "slack" | "discord" | null;
    hasOwner: boolean;
    termsAcceptedAt: number | null;
    termsVersion: string | null;
    createdAt: number;
    updatedAt: number;
    isSite: boolean;
  };
  /** Null when ID couldn't say. */
  members: MemberCounts | null;
  reports: Report[];
  actions: Action[];
};

export type Operator = {
  userId: string;
  displayName: string | null;
  email: string | null;
  teamId: string | null;
  createdAt: number;
  isYou: boolean;
};

/** A reporter an operator blocked: their reporter ID and team number, never who they are. */
export type BlockedReporter = {
  id: string;
  teamNumber: number;
  blockedAt: number;
  blockReason: string | null;
  blockedByName: string | null;
};

export const formatTime = (seconds: number | null | undefined) =>
  seconds ? new Date(seconds * 1000).toLocaleString() : "—";

/** A size in bytes, as KB, MB or GB (1,000s). */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

export const formatDate = (seconds: number | null | undefined) =>
  seconds ? new Date(seconds * 1000).toLocaleDateString() : "—";

export type NotificationType = "info" | "critical";

export type Notification = {
  id: string;
  type: NotificationType;
  summary: string;
  body: string;
  expiresAt: number;
  createdBy: string;
  createdByName: string;
  createdAt: number;
};
