import { useEffect, useState } from "react";
import { FaSlack } from "react-icons/fa";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";

type SlackStatus = {
  connected: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
  /** Connected through the server's settings (G3's setup from before teams), not this page. */
  fromSettings: boolean;
  canConnect: boolean;
};

// The team's Slack workspace: members sign in with codes sent to its bot, and get DMs from it.
export function AdminSlackPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [error, setError] = useState<string | null>(searchParams.get("error"));
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await api.admin.slack.$get();
    if (res.ok) setStatus((await res.json()) as SlackStatus);
    else setError("Couldn't load the Slack connection.");
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load changes on every render but we only want to load once on mount
  useEffect(() => {
    load().catch(() => setError("Couldn't load the Slack connection."));
  }, []);

  async function disconnect() {
    if (
      !confirm(
        "Disconnect Slack? Members won't be able to sign in with Slack until it's reconnected.",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await api.admin.slack.$delete();
      if (!res.ok) setError("Couldn't disconnect Slack.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 px-6 py-8 max-w-2xl mx-auto w-full">
      <h1 className="text-3xl font-bold text-secondary-900 mb-8">Slack</h1>
      <div className="bg-surface border border-secondary-200 rounded-lg p-6 space-y-4">
        <p className="text-sm text-secondary-600">
          Members sign in with codes they send to the bot in your Slack, and the apps message them
          there.
        </p>
        {searchParams.get("connected") && status?.connected && (
          <p className="text-sm text-green-700">Slack is connected.</p>
        )}
        {error && <p className="text-sm text-primary-500">{error}</p>}

        {status && (
          <div className="flex items-center justify-between gap-4 rounded-lg bg-inset px-4 py-3">
            <div className="flex items-center gap-3">
              <FaSlack size={22} className="text-secondary-700" />
              <div>
                <p className="text-sm font-medium text-secondary-900">
                  {status.connected ? (status.workspaceName ?? "Connected") : "Not connected"}
                </p>
                {status.workspaceId && (
                  <p className="text-xs text-secondary-500">Workspace {status.workspaceId}</p>
                )}
              </div>
            </div>
            {status.canConnect && (
              <div className="flex gap-2">
                <a
                  href={`${apiBase}/slack/install`}
                  className="rounded-lg bg-primary-600 hover:bg-primary-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors"
                >
                  {status.connected ? "Reconnect" : "Connect Slack"}
                </a>
                {status.connected && !status.fromSettings && (
                  <button
                    type="button"
                    onClick={disconnect}
                    disabled={busy}
                    className="rounded-lg border border-secondary-300 px-3 py-1.5 text-sm text-secondary-700 hover:border-primary-500 disabled:opacity-50 transition-colors"
                  >
                    Disconnect
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {status && !status.canConnect && (
          <p className="text-xs text-secondary-500">
            Connecting a workspace isn't set up on this server yet.
          </p>
        )}
      </div>
    </main>
  );
}
