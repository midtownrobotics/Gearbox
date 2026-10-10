import { appUrl } from "@g3/site-config";
const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
export const API_URL = `${API_ORIGIN}/scouting`;
export const G3ID_URL = appUrl("id");
const inflightGets = new Map<string, Promise<unknown>>();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? "GET";
  if (method !== "GET") return request<T>(path, init);
  const existing = inflightGets.get(path);
  if (existing) return existing as Promise<T>;
  const pending = request<T>(path, init).finally(() => inflightGets.delete(path));
  inflightGets.set(path, pending);
  return pending;
}
