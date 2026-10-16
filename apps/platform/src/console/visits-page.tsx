import { Card, ErrorBanner, Page, Stat, inputClass } from "@g3/ui";
import { useState } from "react";
import { consoleApi, read, useLoad } from "./data";

// Visits to the public landing page per day (UTC), split into visitors signed in to Gearbox and
// everyone else. Counted once per browser tab session; nothing about a visitor is kept.

type Day = { day: string; visits: number; signedIn: number };

const RANGES = [7, 30, 90] as const;

export function VisitsPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const visits = useLoad(
    () =>
      read<{ visits: Day[] }>(consoleApi.visits.$get({ query: { days: String(days) } })).then(
        (body) => body.visits,
      ),
    [days],
  );
  const rows = visits.data ?? [];
  const total = rows.reduce((sum, d) => sum + d.visits, 0);
  const signedIn = rows.reduce((sum, d) => sum + d.signedIn, 0);
  const most = Math.max(1, ...rows.map((d) => d.visits));

  return (
    <Page
      title="Visitors"
      description="Visits to the landing page, counted once per browser tab. Nothing about a visitor is kept."
    >
      <select
        value={days}
        onChange={(e) => setDays(Number(e.target.value) as typeof days)}
        className={`${inputClass} max-w-40`}
        aria-label="Days"
      >
        {RANGES.map((n) => (
          <option key={n} value={n}>
            Last {n} days
          </option>
        ))}
      </select>
      {visits.error && <ErrorBanner message={visits.error} />}
      <Card>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Visits" value={total} />
          <Stat label="Signed in" value={signedIn} />
          <Stat label="Not signed in" value={total - signedIn} />
        </div>
      </Card>
      <Card title="By day (UTC)">
        {rows.length === 0 ? (
          <p className="text-sm text-secondary-500">No visits in these days.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {rows.map((d) => (
              <li key={d.day} className="grid grid-cols-[6.5rem_1fr_5rem] items-center gap-3">
                <span className="text-secondary-600">{d.day}</span>
                <span className="flex h-3 overflow-hidden rounded bg-inset">
                  <span
                    className="bg-primary-500"
                    style={{ width: `${(d.signedIn / most) * 100}%` }}
                    title={`${d.signedIn} signed in`}
                  />
                  <span
                    className="bg-secondary-400"
                    style={{ width: `${((d.visits - d.signedIn) / most) * 100}%` }}
                    title={`${d.visits - d.signedIn} not signed in`}
                  />
                </span>
                <span className="text-right text-secondary-900">
                  {d.visits} <span className="text-secondary-500">({d.signedIn})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-secondary-500">
          Darker: signed in. In brackets: how many of the day's visits were signed in.
        </p>
      </Card>
    </Page>
  );
}
