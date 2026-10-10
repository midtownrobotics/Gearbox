import { Link } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { formatBytes } from "../../shared/format";
import { Card, ErrorBanner, Loading, Page } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { RangePicker, rangeLabel, useRange } from "./range";

async function loadSites(query: { from: string | undefined; to: string | undefined }) {
  const res = await api.network.sites.$get({ query });
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

export const sitePath = (site: string) => `/network/sites/${encodeURIComponent(site)}`;

/** "(unknown)" and "(other)" aren't real sites; show them muted. */
export const isPseudoSite = (site: string) => site.startsWith("(");

export function SitesPage() {
  const { query, withRange } = useRange();
  const { data, error } = useLoad(() => loadSites(query), [query.from, query.to]);
  if (error)
    return (
      <Page title="Sites">
        <RangePicker range={null} />
        <ErrorBanner message={error} />
      </Page>
    );
  if (!data)
    return (
      <Page title="Sites">
        <Loading />
      </Page>
    );

  const total = data.sites.reduce((sum, s) => sum + s.dl + s.ul, 0);
  return (
    <Page title="Sites">
      <RangePicker range={data.range} />
      <p className="text-sm text-secondary-500">
        Data by site for {rangeLabel(data.range)}, updated hourly. “(unknown)” is traffic the box
        couldn’t name, such as VPNs; “(other)” is each device’s smaller sites.
      </p>
      <Card className="p-0! overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-widest text-secondary-400">
            <tr className="border-b border-secondary-200">
              <th className="px-4 py-3 font-bold w-8">#</th>
              <th className="px-4 py-3 font-bold">Site</th>
              <th className="px-4 py-3 font-bold hidden sm:table-cell">Share</th>
              <th className="px-4 py-3 font-bold text-right">Used</th>
              <th className="px-4 py-3 font-bold text-right">Devices</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {data.sites.map((s, i) => (
              <tr key={s.site} className="hover:bg-secondary-50">
                <td className="px-4 py-2.5 text-secondary-400 tabular-nums">{i + 1}</td>
                <td className="px-4 py-2.5">
                  <Link
                    to={withRange(sitePath(s.site))}
                    className={`font-medium hover:text-primary-500 ${isPseudoSite(s.site) ? "italic text-secondary-500" : "text-secondary-900"}`}
                  >
                    {s.site}
                  </Link>
                </td>
                <td className="px-4 py-2.5 hidden sm:table-cell w-1/3">
                  <div className="h-1.5 rounded-full bg-secondary-100">
                    <div
                      className="h-full rounded-full bg-primary-300"
                      style={{ width: `${((s.dl + s.ul) / Math.max(1, total)) * 100}%` }}
                    />
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                  {formatBytes(s.dl + s.ul)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-secondary-600">
                  {s.devices}
                </td>
              </tr>
            ))}
            {data.sites.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-secondary-400">
                  No site data yet. It appears within about an hour.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
