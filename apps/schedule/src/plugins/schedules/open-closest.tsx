import { ErrorBanner, Page, PageLoading } from "@g3/ui";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { type ScheduleListItem, api, unwrap } from "../../shared/api";
import { nowAt } from "../../shared/time";

// Opening the app, or Schedules in the bar, goes straight to the schedule closest to now: one
// that's on today, else the next to start. Past events and schedules without days are left out;
// with none, the list of every schedule (/schedules/all).

/** The schedule to open: the one on now, or starting soonest; null with none to come. */
export function closestSchedule(schedules: ScheduleListItem[]): ScheduleListItem | null {
  let best: { schedule: ScheduleListItem; first: string } | null = null;
  for (const schedule of schedules) {
    if (!schedule.firstDay || !schedule.lastDay) continue;
    // Each event's "today" is in its own time zone.
    const today = nowAt(schedule.timeZone)?.day ?? new Date().toISOString().slice(0, 10);
    if (schedule.lastDay < today) continue;
    // One that's already on counts as starting today.
    const first = schedule.firstDay < today ? today : schedule.firstDay;
    if (!best || first < best.first) best = { schedule, first };
  }
  return best?.schedule ?? null;
}

export function OpenClosest() {
  const [to, setTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    unwrap(api.schedules.$get())
      .then((schedules) => {
        const closest = closestSchedule(schedules);
        setTo(closest ? `/schedules/${closest.id}` : "/schedules/all");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  if (error) {
    return (
      <Page title="Schedules">
        <ErrorBanner message={error} />
      </Page>
    );
  }
  if (!to) return <PageLoading />;
  return <Navigate to={to} replace />;
}
