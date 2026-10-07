import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { formatBytes, formatDateTime, formatDayKey, formatHour } from "../../shared/format";
import { Card, ErrorBanner, Loading, Page, Stat } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { BarChart, ChartLegend } from "./bar-chart";
import { ClientExceptions } from "./client-exceptions";
import { OnlineDot, PresenceNote } from "./online";
import { isPseudoSite, sitePath } from "./sites-page";

export function ClientDetailPage() {
  const mac = useParams().mac ?? "";
  const { data, error, reload } = useLoad(async () => {
    const res = await api.network.clients[":mac"].$get({ param: { mac } });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, [mac]);

  const back = (
    <Link to="/network/clients" className="text-sm text-secondary-500 hover:text-secondary-900">
      ← All clients
    </Link>
  );
  if (error)
    return (
      <Page title="Client" actions={back}>
        <ErrorBanner message={error} />
      </Page>
    );
  if (!data)
    return (
      <Page title="Client" actions={back}>
        <Loading />
      </Page>
    );

  const { client, daily, hourly, presence } = data;
  const cycleTotal = daily.reduce((sum, d) => sum + d.dl + d.ul, 0);
  const dayTotal = hourly.reduce((sum, h) => sum + h.dl + h.ul, 0);

  return (
    <Page title={client.name} actions={back}>
      <PresenceNote presence={presence} />
      <Card>
        {client.online !== null && (
          <p className="flex items-center gap-2 text-sm font-medium mb-3">
            <OnlineDot online={client.online} />
            <span className={client.online ? "text-emerald-700" : "text-secondary-500"}>
              {client.online ? "Online now" : "Not on the network right now"}
            </span>
          </p>
        )}
        <RenameForm mac={client.mac} current={client.displayName} onSaved={reload} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          <Stat label="This cycle" value={formatBytes(cycleTotal)} />
          <Stat label="Last 24h" value={formatBytes(dayTotal)} />
          <Stat
            label="Last seen"
            value={<span className="text-base">{formatDateTime(client.lastSeenAt)}</span>}
          />
          <Stat
            label="First seen"
            value={<span className="text-base">{formatDateTime(client.firstSeenAt)}</span>}
          />
        </div>
        <dl className="mt-4 text-xs text-secondary-500 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="font-bold">MAC</dt>
          <dd className="font-mono">{client.mac}</dd>
          <dt className="font-bold">Hostname</dt>
          <dd>{client.hostname ?? "—"}</dd>
          <dt className="font-bold">Last IP</dt>
          <dd className="font-mono">{client.lastIp ?? "—"}</dd>
        </dl>
      </Card>

      <Card title="Daily usage this cycle">
        <BarChart
          bars={daily.map((d) => ({
            label: formatDayKey(d.day),
            tick: String(Number(d.day.slice(8))),
            dl: d.dl,
            ul: d.ul,
          }))}
        />
        <ChartLegend />
      </Card>

      <Card title="Last 24 hours">
        <BarChart
          bars={hourly.map((h) => ({
            label: formatDateTime(h.hour),
            tick: formatHour(h.hour),
            dl: h.dl,
            ul: h.ul,
          }))}
        />
      </Card>

      <ClientExceptions mac={client.mac} />
      <ClientSites mac={client.mac} />
    </Page>
  );
}

/** Admin-only: this device’s top sites this cycle. */
function ClientSites({ mac }: { mac: string }) {
  const user = useAuthUser();
  const { data, error } = useLoad(async () => {
    if (!user.isAdmin) return null;
    const res = await api.network.sites.client[":mac"].$get({ param: { mac } });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, [mac, user.isAdmin]);
  if (!user.isAdmin) return null;

  return (
    <Card title="Top sites this cycle">
      {error && <ErrorBanner message={error} />}
      {!data && !error && <Loading />}
      {data && data.sites.length === 0 && (
        <p className="text-sm text-secondary-400">No site data yet.</p>
      )}
      {data && data.sites.length > 0 && (
        <ul className="divide-y divide-secondary-100">
          {data.sites.map((s) => (
            <li key={s.site} className="py-2 flex items-center justify-between gap-3">
              <Link
                to={sitePath(s.site)}
                className={`truncate hover:text-primary-500 ${isPseudoSite(s.site) ? "italic text-secondary-500" : "text-secondary-900 font-medium"}`}
              >
                {s.site}
              </Link>
              <span className="text-sm text-secondary-600 tabular-nums">
                {formatBytes(s.dl + s.ul)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RenameForm({
  mac,
  current,
  onSaved,
}: { mac: string; current: string | null; onSaved: () => void }) {
  const user = useAuthUser();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!user.isAdmin) return null;

  async function save() {
    setError(null);
    const res = await api.network.clients[":mac"].$patch({
      param: { mac },
      json: { displayName: name },
    });
    if (!res.ok) return setError(await getErrorMessage(res));
    setEditing(false);
    onSaved();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setName(current ?? "");
          setEditing(true);
        }}
        className="text-sm text-primary-500 hover:text-primary-700 font-medium"
      >
        Rename
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        className="border border-secondary-300 rounded-lg px-2 py-1 w-64"
        value={name}
        maxLength={64}
        placeholder="Name (blank to use hostname)"
        onChange={(e) => setName(e.target.value)}
        // biome-ignore lint/a11y/noAutofocus: inline edit field opened by the user
        autoFocus
      />
      <button
        type="submit"
        className="bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-lg px-3 py-1"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-secondary-500 hover:text-secondary-900"
      >
        Cancel
      </button>
      {error && <span className="text-primary-600">{error}</span>}
    </form>
  );
}
