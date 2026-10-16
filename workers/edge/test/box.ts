import { call } from "@g3/testing/worker";

/** A request from a team's box: its key, on its team's address (the gateway's X-Team-Id). */
export function boxCall(teamId: string, key: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("X-Team-Id", teamId);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!headers.has("X-G3-Agent-Version")) {
    headers.set("X-G3-Agent-Version", "test");
    headers.set("X-G3-Agent-Started", "1000");
  }
  return call(path, { ...init, headers });
}
