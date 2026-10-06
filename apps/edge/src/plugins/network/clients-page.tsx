import { Link, useSearchParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { formatAgo, formatBytes } from "../../shared/format";
import { Card, ErrorBanner, Loading, Page } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { OnlineDot, PresenceNote } from "./online";

async function loadClients() {
  const res = await api.network.clients.$get();
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

export function ClientsPage() {
  // Each load asks the edge box who's on the LAN right now (through the tunnel).
  const { data, error, reload } = useLoad(loadClients, []);
  const [params, setParams] = useSearchParams();
  const onlineOnly = params.get("online") === "1";
  const setOnlineOnly = (on: boolean) =>
    setParams(
      (p) => {
        if (on) p.set("online", "1");
        else p.delete("online");
        return p;
      },
      { replace: true },
    );

  if (error)
    return (
      <Page title="Clients">
        <ErrorBanner message={error} />
      </Page>
    );
  if (!data)
    return (
      <Page title="Clients">
        <Loading />
      </Page>
    );

  const all = [...data.clients].sort((a, b) => b.cycle.dl + b.cycle.ul - (a.cycle.dl + a.cycle.ul));
  const onlineCount = all.filter((c) => c.online).length;
  const clients = onlineOnly ? all.filter((c) => c.online) : all;
  const canFilter = data.presence.available;

  const filterButton = (on: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={onlineOnly === on}
      onClick={() => setOnlineOnly(on)}
      disabled={on && !canFilter}
      className={`px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
        onlineOnly === on
          ? "bg-secondary-900 text-white"
          : "bg-white text-secondary-600 hover:bg-secondary-50"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Page
      title="Clients"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex rounded-lg border border-secondary-200 overflow-hidden">
            {filterButton(false, `All (${all.length})`)}
            {filterButton(true, canFilter ? `Online now (${onlineCount})` : "Online now")}
          </div>
          <button
            type="button"
            onClick={reload}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-secondary-200 bg-white text-secondary-600 hover:bg-secondary-50"
          >
            Refresh
          </button>
        </div>
      }
    >
      <PresenceNote presence={data.presence} />
      <Card className="p-0! overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-widest text-secondary-400">
            <tr className="border-b border-secondary-200">
              <th className="px-4 py-3 font-bold w-8">#</th>
              <th className="px-4 py-3 font-bold">Device</th>
              <th className="px-4 py-3 font-bold text-right">This cycle</th>
              <th className="px-4 py-3 font-bold text-right">Last 24h</th>
              <th className="px-4 py-3 font-bold text-right">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {clients.map((c, i) => (
              <tr key={c.mac} className="hover:bg-secondary-50">
                <td className="px-4 py-2.5 text-secondary-400 tabular-nums">{i + 1}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <OnlineDot online={c.online} />
                    <Link
                      to={`/network/clients/${encodeURIComponent(c.mac)}`}
                      className="font-medium text-secondary-900 hover:text-primary-500"
                    >
                      {c.name}
                    </Link>
                  </div>
                  <p className="text-xs text-secondary-400">
                    {c.hostname && c.displayName ? `${c.hostname} · ` : ""}
                    {c.lastIp ?? c.mac}
                  </p>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                  {formatBytes(c.cycle.dl + c.cycle.ul)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-secondary-600">
                  {formatBytes(c.last24h.dl + c.last24h.ul)}
                </td>
                <td className="px-4 py-2.5 text-right text-secondary-500 whitespace-nowrap">
                  {c.online ? (
                    <span className="text-emerald-700 font-medium">Online now</span>
                  ) : (
                    formatAgo(c.lastSeenAt)
                  )}
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-secondary-400">
                  {onlineOnly ? "No devices are online right now." : "No clients seen yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
