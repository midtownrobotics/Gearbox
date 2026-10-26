import { Card, ErrorBanner, Page, PageLoading, Stat } from "@g3/ui";
import { consoleApi, read, useLoad } from "./data";

// How Gearbox is used: teams, members and how many teams have each app on. Counts only, leaving
// out the public demo; for operators, not shown anywhere public.

type Stats = {
  teams: { active: number; pending: number; suspended: number; newThisMonth: number };
  members: {
    active: number;
    pending: number;
    mentors: number;
    online: number;
    activeWeek: number;
    activeMonth: number;
    joinedMonth: number;
  };
  apps: { slug: string; name: string; teams: number }[];
};

export function StatsPage() {
  const stats = useLoad(() => read<Stats>(consoleApi.stats.$get()), []);
  const data = stats.data;

  return (
    <Page
      title="Stats"
      description="How Gearbox is used, as counts only. The public demo isn't counted."
    >
      {stats.error && <ErrorBanner message={stats.error} />}
      {!data ? (
        !stats.error && <PageLoading />
      ) : (
        <>
          <Card title="Teams">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Active" value={data.teams.active} />
              <Stat label="Signing up" value={data.teams.pending} />
              <Stat label="Suspended" value={data.teams.suspended} />
              <Stat label="New in 30 days" value={data.teams.newThisMonth} />
            </div>
          </Card>
          <Card title="Members">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat
                label="Members"
                value={data.members.active}
                hint={`${data.members.mentors} mentors`}
              />
              <Stat label="Online now" value={data.members.online} hint="In the last 5 minutes" />
              <Stat label="Active, 7 days" value={data.members.activeWeek} />
              <Stat label="Active, 30 days" value={data.members.activeMonth} />
              <Stat label="Joined in 30 days" value={data.members.joinedMonth} />
              <Stat label="Awaiting approval" value={data.members.pending} />
            </div>
          </Card>
          <Card title="Apps on, of active teams">
            <AppList apps={data.apps} activeTeams={data.teams.active} />
          </Card>
        </>
      )}
    </Page>
  );
}

function AppList({ apps, activeTeams }: { apps: Stats["apps"]; activeTeams: number }) {
  const sorted = [...apps].sort((a, b) => b.teams - a.teams || a.name.localeCompare(b.name));
  const most = Math.max(1, activeTeams);
  return (
    <ul className="space-y-1.5 text-sm">
      {sorted.map((app) => (
        <li key={app.slug} className="grid grid-cols-[7rem_1fr_6rem] items-center gap-3">
          <span className="truncate text-secondary-600" title={app.name}>
            {app.name}
          </span>
          <span className="flex h-3 overflow-hidden rounded bg-inset">
            <span className="bg-primary-500" style={{ width: `${(app.teams / most) * 100}%` }} />
          </span>
          <span className="text-right text-secondary-900">
            {app.teams}{" "}
            <span className="text-secondary-500">({Math.round((app.teams / most) * 100)}%)</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
