import { consoleUrl, site, teamAppUrl } from "@g3/site-config";
import { type ReactNode, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { GearMark } from "../layout";
import { consoleApi, read, useLoad } from "./data";

// The operators' console (roadmap 2.8), at admin.<domain>/console. Operators sign in through their
// own team's sign-in page (G3ID), like anyone else; the platform says whether they're an operator.

type Me = { user: { id: string; displayName: string; email: string }; isOperator: boolean };

const PAGES = [
  { to: "/console", label: "Teams", end: true },
  { to: "/console/reports", label: "Reports" },
  { to: "/console/operators", label: "Operators" },
  { to: "/console/log", label: "Log" },
];

/** G3ID's sign-in for team `number`, coming back to the console on that team's domain. */
function signInUrl(number: number): string {
  if (import.meta.env.DEV) {
    return `http://localhost:5173/login?redirect=${encodeURIComponent(window.location.href)}`;
  }
  const team = `frc${number}`;
  return `${teamAppUrl(team, "id")}/login?redirect=${encodeURIComponent(`${consoleUrl(team)}/console`)}`;
}

export function ConsoleShell() {
  const load = useLoad(async (): Promise<Me | "signed out"> => {
    const res = await consoleApi.me.$get();
    if (res.status === 401) return "signed out";
    return read<Me>(Promise.resolve(res));
  }, []);
  const me = load.data === "signed out" ? null : load.data;

  let body: ReactNode = null;
  if (load.error) body = <Notice>{load.error}</Notice>;
  else if (load.data === "signed out") body = <SignIn />;
  else if (me && !me.isOperator) body = <NotOperator me={me} />;
  else if (me) body = <Outlet />;

  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="flex items-center gap-2 font-bold text-secondary-900">
            <GearMark small /> Gearbox console
          </span>
          {me?.isOperator && (
            <nav className="flex flex-wrap gap-1 text-sm">
              {PAGES.map((page) => (
                <NavLink
                  key={page.to}
                  to={page.to}
                  end={page.end}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 ${isActive ? "bg-inset font-semibold text-secondary-900" : "text-secondary-600 hover:text-secondary-900"}`
                  }
                >
                  {page.label}
                </NavLink>
              ))}
            </nav>
          )}
          {me && <span className="ml-auto text-sm text-secondary-500">{me.user.displayName}</span>}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{body}</main>
    </div>
  );
}

function SignIn() {
  const [number, setNumber] = useState(String(site.team.number));
  return (
    <Panel title="Sign in">
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
        <input
          required
          inputMode="numeric"
          pattern="[0-9]*"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className="w-32 rounded-lg border border-secondary-300 bg-surface px-3 py-2"
          aria-label="Team number"
        />
        <button type="submit" className={buttonClass("primary")}>
          Sign in
        </button>
      </form>
    </Panel>
  );
}

function NotOperator({ me }: { me: Me }) {
  return (
    <Panel title="Operators only">
      <p className="text-sm text-secondary-600">
        You're signed in as {me.user.displayName} ({me.user.email}), who isn't a platform operator.
        An operator can add you on the Operators page with your account id:
      </p>
      <code className="mt-3 block rounded-lg bg-inset px-3 py-2 text-sm text-secondary-900">
        {me.user.id}
      </code>
    </Panel>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      {title && <h2 className="mb-2 text-lg font-semibold text-secondary-900">{title}</h2>}
      {children}
    </section>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-700">
      {children}
    </p>
  );
}

export function buttonClass(kind: "primary" | "danger" | "plain" = "plain") {
  const base = "rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50";
  if (kind === "primary") return `${base} bg-primary-600 text-white hover:bg-primary-500`;
  if (kind === "danger") return `${base} bg-red-600 text-white hover:bg-red-500`;
  return `${base} border border-line bg-surface text-secondary-800 hover:bg-inset`;
}

export const fieldClass =
  "w-full rounded-lg border border-secondary-300 bg-surface px-3 py-2 text-sm text-secondary-900 focus:border-primary-500 focus:outline-none";

const STATUS_STYLES = {
  active: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-800",
  suspended: "bg-red-100 text-red-800",
  open: "bg-amber-100 text-amber-800",
  resolved: "bg-secondary-100 text-secondary-700",
} as const;

export function StatusBadge({ status }: { status: keyof typeof STATUS_STYLES }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}
