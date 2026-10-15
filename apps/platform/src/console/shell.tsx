import { consoleUrl, site, teamAppUrl } from "@g3/site-config";
import { versionLabel } from "@g3/site-config/versions";
import {
  AppNavBar,
  Badge,
  Button,
  Card,
  ErrorBanner,
  Page,
  PageLoading,
  TextField,
  activePath,
  linkWith,
  tones,
} from "@g3/ui";
import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { consoleApi, read, useLoad } from "./data";

// The operators' console (roadmap 2.8), at admin.<domain>/console. Operators sign in through their
// own team's sign-in page (G3ID), like anyone else; the platform says whether they're an operator.
// It has the bar and parts every app has, in the built-in colors: it belongs to no team.

type Me = { user: { id: string; displayName: string; email: string }; isOperator: boolean };

const PAGES = [
  { to: "/console", label: "Teams" },
  { to: "/console/reports", label: "Reports" },
  { to: "/console/notifications", label: "Notifications" },
  { to: "/console/operators", label: "Operators" },
  { to: "/console/log", label: "Log" },
];

const routerLink = linkWith(Link);

/** G3ID's sign-in for team `number`, coming back to the console on that team's domain. */
function signInUrl(number: number): string {
  if (import.meta.env.DEV) {
    return `http://localhost:5173/login?redirect=${encodeURIComponent(window.location.href)}`;
  }
  const team = `frc${number}`;
  return `${teamAppUrl(team, "id")}/login?redirect=${encodeURIComponent(`${consoleUrl(team)}/console`)}`;
}

export function ConsoleShell() {
  const { pathname } = useLocation();
  const load = useLoad(async (): Promise<Me | "signed out"> => {
    const res = await consoleApi.me.$get();
    if (res.status === 401) return "signed out";
    return read<Me>(Promise.resolve(res));
  }, []);
  const me = load.data === "signed out" ? null : load.data;
  const pages = me?.isOperator ? PAGES : [];
  const active = activePath(
    pathname,
    pages.map((page) => page.to),
  );

  let body = <PageLoading />;
  if (load.error)
    body = (
      <Page title="Console" width="narrow">
        <ErrorBanner message={load.error} />
      </Page>
    );
  else if (load.data === "signed out") body = <SignIn />;
  else if (me && !me.isOperator) body = <NotOperator me={me} />;
  else if (me) body = <Outlet />;

  return (
    <div className="flex flex-1 flex-col bg-page">
      <AppNavBar
        team={false}
        title="GEARBOX CONSOLE"
        icon="/favicon.svg"
        homeHref="/console"
        version={versionLabel("Console")}
        link={routerLink}
        items={pages.map((page) => ({
          key: page.to,
          label: page.label,
          href: page.to,
          active: page.to === active,
        }))}
        actions={
          me && <span className="g3-nav-text-link g3-nav-hello">Hello, {me.user.displayName}!</span>
        }
      />
      {body}
    </div>
  );
}

function SignIn() {
  const [number, setNumber] = useState(String(site.team.number));
  return (
    <Page title="Sign in" width="narrow">
      <Card>
        <p className="text-sm text-secondary-600">
          Sign in through your own team. Which team are you on?
        </p>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            window.location.href = signInUrl(Number(number));
          }}
        >
          <div className="w-32">
            <TextField
              kind="title"
              required
              inputMode="numeric"
              pattern="[0-9]*"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              aria-label="Team number"
            />
          </div>
          <Button type="submit">Sign in</Button>
        </form>
      </Card>
    </Page>
  );
}

function NotOperator({ me }: { me: Me }) {
  return (
    <Page title="Operators only" width="narrow">
      <Card>
        <p className="text-sm text-secondary-600">
          You're signed in as {me.user.displayName} ({me.user.email}), who isn't a platform
          operator. An operator can add you on the Operators page with your account id:
        </p>
        <code className="mt-3 block rounded-lg bg-inset px-3 py-2 text-sm text-secondary-900">
          {me.user.id}
        </code>
      </Card>
    </Page>
  );
}

const STATUSES = {
  active: { label: "Active", colors: tones.success },
  pending: { label: "Signing up", colors: tones.warning },
  suspended: { label: "Suspended", colors: tones.danger },
  open: { label: "Open", colors: tones.warning },
  resolved: { label: "Resolved", colors: tones.neutral },
} as const;

/** A team's or a report's status. */
export function StatusBadge({ status }: { status: keyof typeof STATUSES }) {
  return <Badge colors={STATUSES[status].colors}>{STATUSES[status].label}</Badge>;
}
