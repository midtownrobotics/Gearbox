import type { AppEnv } from "../types";

/**
 * The agent couldn't be used: 503 when the box can't be reached (offline,
 * hotspot down, cloudflared stopped) or isn't configured, 502 when it
 * rejected the worker's key.
 */
export class AgentError extends Error {
  constructor(
    message: string,
    readonly status: 502 | 503,
  ) {
    super(message);
  }
}

/**
 * Calls the agent's local API through the tunnel (EDGE_AGENT_URL) with the
 * shared key. Throws AgentError when the box can't be used; otherwise returns
 * the agent's response as-is.
 */
export async function agentFetch(
  env: AppEnv["Bindings"],
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
  /** A different agent than EDGE_AGENT_URL/EDGE_AGENT_KEY (dev lookups on the real box). */
  agent: { url?: string; key?: string } = {},
) {
  const agentUrl = agent.url ?? env.EDGE_AGENT_URL;
  const agentKey = agent.key ?? env.EDGE_AGENT_KEY;
  if (!agentUrl) {
    throw new AgentError("The edge box isn't set up (the worker has no EDGE_AGENT_URL).", 503);
  }
  const { timeoutMs = 15_000, headers, ...rest } = init;
  const unreachable = "The edge box isn't reachable right now. Try again once it's back online.";
  let res: Response;
  try {
    res = await fetch(`${agentUrl}${path}`, {
      ...rest,
      headers: {
        ...(headers as Record<string, string>),
        Authorization: `Bearer ${agentKey}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new AgentError(timedOut ? "The edge box didn't respond in time." : unreachable, 503);
  }
  // 530: cloudflared isn't connected. 502-504: tunnel up, agent not answering.
  if (res.status === 530 || (res.status >= 502 && res.status <= 504)) {
    throw new AgentError(unreachable, 503);
  }
  if (res.status === 401) {
    throw new AgentError(
      "The edge box rejected the worker's key (EDGE_AGENT_KEY doesn't match).",
      502,
    );
  }
  return res;
}
