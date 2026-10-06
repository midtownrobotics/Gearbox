import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { formatAgo, formatDateTime, formatDuration } from "../../shared/format";
import { Card, ErrorBanner, Loading, Page, Stat } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";

async function loadStatus() {
  const res = await api.status.$get();
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

export function StatusPage() {
  const { data, error } = useLoad(loadStatus, []);
  if (error)
    return (
      <Page title="Edge Box">
        <ErrorBanner message={error} />
      </Page>
    );
  if (!data)
    return (
      <Page title="Edge Box">
        <Loading />
      </Page>
    );

  const { agent, now } = data;
  return (
    <Page title="Edge Box">
      <Card>
        {agent ? (
          <>
            <p className="flex items-center gap-2 font-medium text-secondary-900">
              <span
                className={`w-2.5 h-2.5 rounded-full ${agent.online ? "bg-emerald-500" : "bg-secondary-300"}`}
                aria-hidden
              />
              The edge box is {agent.online ? "online" : "offline"}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
              <Stat
                label="Last contact"
                value={formatAgo(agent.lastSeenAt, now)}
                hint={formatDateTime(agent.lastSeenAt)}
              />
              <Stat label="Agent version" value={agent.version} />
              <Stat
                label="Agent uptime"
                value={formatDuration(now - agent.startedAt)}
                hint={`since ${formatDateTime(agent.startedAt)}`}
              />
              <Stat
                label="Settings"
                value={agent.appliedStateVersion >= data.stateVersion ? "Applied" : "Pending"}
                hint={
                  agent.appliedStateVersion >= data.stateVersion
                    ? "Blocklists and exceptions are up to date"
                    : "The box hasn't applied the latest changes yet"
                }
              />
            </div>
            {!agent.online && (
              <p className="text-sm text-secondary-500 mt-4">
                The box keeps routing and enforcing its last settings while offline, and uploads
                buffered usage and picks up changes when it reconnects.
              </p>
            )}
          </>
        ) : (
          <p className="text-secondary-500">The agent hasn't checked in yet.</p>
        )}
      </Card>
      <TunnelCard />
    </Page>
  );
}

const TUNNEL_STATES = {
  connected: {
    dot: "bg-emerald-500",
    label: "Connected",
    hint: "Changes made in the UI reach the box within seconds.",
  },
  agent_unreachable: {
    dot: "bg-amber-400",
    label: "Tunnel up, agent not answering",
    hint: "cloudflared is connected, but nothing answered on the agent's port. Check `systemctl status g3-edge-agent` on the box.",
  },
  tunnel_down: {
    dot: "bg-secondary-300",
    label: "Tunnel down",
    hint: "cloudflared on the box isn't connected (box offline, hotspot down, or cloudflared stopped). Changes still reach the box within 5 minutes of it reconnecting.",
  },
  not_configured: {
    dot: "bg-secondary-300",
    label: "Not configured",
    hint: "The worker has no EDGE_AGENT_URL. Changes still reach the box within 5 minutes.",
  },
  error: {
    dot: "bg-amber-400",
    label: "Couldn't reach the box",
    hint: "The check failed. Changes still reach the box within 5 minutes via its regular uploads.",
  },
} as const;

async function checkTunnel() {
  const res = await api.status.tunnel.$get();
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

/** Live check of the worker → box tunnel (the edge-agent subdomain). */
function TunnelCard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof checkTunnel>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setData(await checkTunnel());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void recheck();
  }, [recheck]);

  return (
    <Card title="Tunnel">
      {error && <ErrorBanner message={error} />}
      {!data && !error && <p className="text-sm text-secondary-400">Checking…</p>}
      {data && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 font-medium text-secondary-900">
              <span
                className={`w-2.5 h-2.5 rounded-full ${TUNNEL_STATES[data.state].dot}`}
                aria-hidden
              />
              {TUNNEL_STATES[data.state].label}
              {data.latencyMs !== null && data.state === "connected" && (
                <span className="text-sm font-normal text-secondary-400">{data.latencyMs} ms</span>
              )}
            </p>
            <p className="text-sm text-secondary-500 mt-1">{TUNNEL_STATES[data.state].hint}</p>
            {data.detail && <p className="text-xs text-secondary-400 mt-1">{data.detail}</p>}
            <p className="text-xs text-secondary-400 mt-1">
              Checked {formatDateTime(data.checkedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={recheck}
            disabled={checking}
            className="text-sm font-medium rounded-lg px-3 py-1.5 text-secondary-600 hover:text-secondary-900 hover:bg-secondary-100 disabled:opacity-50"
          >
            {checking ? "Checking…" : "Check again"}
          </button>
        </div>
      )}
    </Card>
  );
}
