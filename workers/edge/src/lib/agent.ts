import type { AppEnv } from "../types";
import {
  DISCONNECT_PATH,
  LINK_ERROR_HEADER,
  LINK_TIMEOUT_HEADER,
  STATUS_PATH,
  agentLink,
} from "./agent-link";
import type { LinkStatus } from "./agent-link";

/** The agent couldn't be used: 503 when the box isn't connected or didn't answer in time. */
export class AgentError extends Error {
  constructor(
    message: string,
    readonly status: 502 | 503,
  ) {
    super(message);
  }
}

const OFFLINE = "The edge box isn't connected right now. Try again once it's back online.";

/**
 * Calls the agent's local API over the team's box link (its WebSocket to the
 * team's AgentLink Durable Object). The agent adds its own key, so the request runs
 * exactly as if it had been made on the box. Throws AgentError when the box
 * can't be used; otherwise returns the agent's response as-is.
 */
export async function agentFetch(
  env: AppEnv["Bindings"],
  teamId: string,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
) {
  const { timeoutMs = 15_000, ...rest } = init;
  // Through Request, so FormData and other bodies get their Content-Type.
  const request = new Request(`http://agent${path}`, rest);
  request.headers.set(LINK_TIMEOUT_HEADER, String(timeoutMs));
  const res = await agentLink(env, teamId).fetch(request);
  const failure = res.headers.get(LINK_ERROR_HEADER);
  if (failure === "timeout") throw new AgentError("The edge box didn't respond in time.", 503);
  if (failure) throw new AgentError(OFFLINE, 503);
  return res;
}

/** Whether the box is connected right now, and since when. */
export async function linkStatus(env: AppEnv["Bindings"], teamId: string): Promise<LinkStatus> {
  const res = await agentLink(env, teamId).fetch(`http://agent${STATUS_PATH}`);
  return (await res.json()) as LinkStatus;
}

/** Closes the team's box connection (after its key changes). */
export async function disconnectBox(env: AppEnv["Bindings"], teamId: string) {
  await agentLink(env, teamId).fetch(`http://agent${DISCONNECT_PATH}`);
}

/** For a 404 from a route the agent has had since this version. */
export const AGENT_TOO_OLD = "The edge box's agent is too old for this. Upgrade it.";
