import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
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
      <BoxKeyCard hasBox={data.hasBox} />
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
          <p className="text-secondary-500">
            {data.hasBox
              ? "The agent hasn't checked in yet."
              : "Your team hasn't set up an edge box. An admin makes its key below."}
          </p>
        )}
      </Card>
      <AddressesCard
        publicIp={agent?.publicIp ?? null}
        publicIpSince={agent?.publicIpSince ?? null}
      />
      <ConnectionCard />
    </Page>
  );
}

const button = "text-sm font-medium rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50";

/**
 * The team's box key (admins): made here and shown once, then set as EDGE_AGENT_KEY in the box's
 * /etc/g3-edge/agent.env. Making a new one disconnects a box still on the old one.
 */
function BoxKeyCard({ hasBox }: { hasBox: boolean }) {
  const user = useAuthUser();
  const box = useLoad(async () => {
    if (!user.isAdmin) return null;
    const res = await api.box.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return (await res.json()).box;
  }, []);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user.isAdmin) return null;

  async function makeKey() {
    if (
      box.data &&
      !window.confirm("Make a new key? The box disconnects until its agent.env has the new one.")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api.box.key.$post();
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    setKey((await res.json()).key);
    box.reload();
  }

  return (
    <Card title="Box key">
      {box.error && <ErrorBanner message={box.error} />}
      {error && <ErrorBanner message={error} />}
      {key ? (
        <div className="space-y-2">
          <p className="text-sm text-secondary-700">
            Put this in the box's <code>/etc/g3-edge/agent.env</code> as <code>EDGE_AGENT_KEY</code>{" "}
            and restart the agent. It won't be shown again.
          </p>
          <code className="block break-all rounded-lg bg-secondary-100 p-3 text-sm">{key}</code>
        </div>
      ) : (
        <p className="text-sm text-secondary-600">
          {box.data
            ? `The box signs in with the key ending ${box.data.keyHint}, made by ${box.data.createdByName} on ${formatDateTime(box.data.createdAt)}.`
            : hasBox
              ? "Loading…"
              : "Make a key for your team's box. Its agent signs in with it."}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void makeKey()}
        className={`${button} mt-3 bg-primary-500 hover:bg-primary-600 text-white`}
      >
        {box.data ? "Make a new key" : "Make the box's key"}
      </button>
    </Card>
  );
}

const LINK_STATES = {
  connected: {
    dot: "bg-emerald-500",
    label: "Connected",
    hint: "The box keeps a connection open to the worker, so printing, part lookups and changes made here reach it within seconds.",
  },
  not_answering: {
    dot: "bg-amber-400",
    label: "Connected, agent not answering",
    hint: "The box's connection is open, but the agent didn't answer. Check `systemctl status g3-edge-agent` on the box.",
  },
  offline: {
    dot: "bg-secondary-300",
    label: "Not connected",
    hint: "The box isn't connected (offline, hotspot down, or the agent stopped). It reconnects by itself, and picks up changes within 5 minutes of coming back.",
  },
} as const;

async function checkConnection() {
  const res = await api.status.connection.$get();
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

/** Live check of the box's connection to the worker (its WebSocket). */
function ConnectionCard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof checkConnection>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setData(await checkConnection());
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
    <Card title="Connection">
      {error && <ErrorBanner message={error} />}
      {!data && !error && <p className="text-sm text-secondary-400">Checking…</p>}
      {data && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 font-medium text-secondary-900">
              <span
                className={`w-2.5 h-2.5 rounded-full ${LINK_STATES[data.state].dot}`}
                aria-hidden
              />
              {LINK_STATES[data.state].label}
              {data.latencyMs !== null && data.state === "connected" && (
                <span className="text-sm font-normal text-secondary-400">{data.latencyMs} ms</span>
              )}
            </p>
            <p className="text-sm text-secondary-500 mt-1">{LINK_STATES[data.state].hint}</p>
            {data.detail && <p className="text-xs text-secondary-400 mt-1">{data.detail}</p>}
            <p className="text-xs text-secondary-400 mt-1">
              {data.connectedAt && `Connected since ${formatDateTime(data.connectedAt)} · `}
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

async function loadInterfaces() {
  const res = await api.status.interfaces.$get();
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

const ROLE_LABELS = {
  lan: { label: "LAN", hint: "The shop network" },
  wan: { label: "WAN", hint: "The hotspot" },
} as const;

/**
 * The box's public address (recorded from its uploads, so it shows even when the
 * box is offline) and its LAN/WAN addresses, read live on the box.
 */
function AddressesCard({
  publicIp,
  publicIpSince,
}: { publicIp: string | null; publicIpSince: number | null }) {
  const { data, error, reload } = useLoad(loadInterfaces, []);
  return (
    <Card title="Addresses">
      <div className="mb-4">
        <p className="text-xs font-bold uppercase tracking-widest text-secondary-400">
          Public{" "}
          <span className="font-normal normal-case tracking-normal">
            Where the box's traffic comes from on the internet
          </span>
        </p>
        {publicIp ? (
          <>
            <p className="font-mono break-all text-lg text-secondary-900 mt-1">{publicIp}</p>
            {publicIpSince && (
              <p className="text-xs text-secondary-400 mt-0.5">
                Since {formatDateTime(publicIpSince)}. The carrier can change it, and other
                customers may share it.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-secondary-500 mt-1">
            Not known yet; it's recorded at the box's next upload.
          </p>
        )}
      </div>
      {error && <ErrorBanner message={error} />}
      {!data && !error && <p className="text-sm text-secondary-400">Checking…</p>}
      {data && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4 min-w-0">
            {data.interfaces.map((i) => (
              <div key={i.role} className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-secondary-400">
                  {ROLE_LABELS[i.role].label}{" "}
                  <span className="font-normal normal-case tracking-normal">
                    {ROLE_LABELS[i.role].hint} · {i.name}
                    {i.state && i.state !== "up" ? ` · ${i.state}` : ""}
                    {!i.state ? " · not found" : ""}
                  </span>
                </p>
                {i.addresses.length === 0 ? (
                  <p className="text-sm text-secondary-500 mt-1">No address</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {i.addresses.map((a) => (
                      <li
                        key={a.address}
                        className={`font-mono break-all ${a.family === "ipv4" ? "text-lg text-secondary-900" : "text-xs text-secondary-500"}`}
                      >
                        {a.address}
                        <span className="text-secondary-400">/{a.prefixLength}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {i.mac && <p className="text-xs text-secondary-400 font-mono mt-0.5">{i.mac}</p>}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={reload}
            className="text-sm font-medium rounded-lg px-3 py-1.5 text-secondary-600 hover:text-secondary-900 hover:bg-secondary-100"
          >
            Refresh
          </button>
        </div>
      )}
      {data && (
        <p className="text-xs text-secondary-400 mt-3">Checked {formatDateTime(data.checkedAt)}</p>
      )}
    </Card>
  );
}
