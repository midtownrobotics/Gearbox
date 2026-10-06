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

export type TeamStatus = "pending" | "active" | "suspended";

export type TeamRow = {
  id: string;
  teamNumber: number;
  name: string;
  country: string;
  status: TeamStatus;
  slackWorkspaceName: string | null;
  createdAt: number;
  openReports: number;
  isSite: boolean;
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
    slackWorkspaceName: string | null;
    founder: { id: string; name: string } | null;
    owner: { id: string; name: string } | null;
    termsAcceptedAt: number | null;
    createdAt: number;
    updatedAt: number;
    isSite: boolean;
  };
  members: Member[];
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

export const formatTime = (seconds: number | null | undefined) =>
  seconds ? new Date(seconds * 1000).toLocaleString() : "—";

export const formatDate = (seconds: number | null | undefined) =>
  seconds ? new Date(seconds * 1000).toLocaleDateString() : "—";
