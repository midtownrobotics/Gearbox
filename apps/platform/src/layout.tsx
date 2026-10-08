import { site } from "@g3/site-config";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import g3Logo from "./assets/g3.png";
import { MyTeamButton } from "./team-pages";

// The platform's header and footer, shared by its pages.

export function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link to="/" className="flex items-center gap-2">
          <GearMark />
          <span className="text-lg font-bold tracking-tight text-secondary-900">Gearbox</span>
          <ByTeam className="hidden sm:flex" />
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <a href="/#apps" className="hidden text-secondary-600 hover:text-secondary-900 sm:block">
            Apps
          </a>
          <a href="/#how" className="hidden text-secondary-600 hover:text-secondary-900 sm:block">
            Set up
          </a>
          <a
            href="/#customize"
            className="hidden text-secondary-600 hover:text-secondary-900 sm:block"
          >
            Make it yours
          </a>
          <MyTeamButton />
          <Link
            to="/signup"
            className="hidden rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-primary-500 sm:block"
          >
            Sign up your team
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-sm text-secondary-500 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-semibold text-secondary-900">
            <GearMark small /> Gearbox <ByTeam />
          </p>
          <p>
            Free, open source (MIT), and run by volunteers from {site.team.name}, FRC Team{" "}
            {site.team.number}.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <a href={site.legal.terms} className="hover:text-secondary-900">
            Terms
          </a>
          <a href={site.legal.privacy} className="hover:text-secondary-900">
            Privacy
          </a>
          <a href={site.sourceUrl} className="hover:text-secondary-900">
            Source code
          </a>
          <Link to="/report" className="hover:text-secondary-900">
            Report a team number
          </Link>
        </div>
      </div>
    </footer>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

/**
 * "by G3 Robotics", with the team's logo standing in for its short name (the logo says "G3"):
 * "by [logo] Robotics". The full name stays in the logo's alt text.
 */
function ByTeam({ className = "" }: { className?: string }) {
  const { name, shortName } = site.team;
  const rest = name.startsWith(shortName) ? name.slice(shortName.length).trim() : name;
  return (
    <span
      className={`items-center gap-1 border-l border-line pl-2 text-xs font-medium text-secondary-500 ${className || "flex"}`}
    >
      by
      <img src={g3Logo} alt={name} className="h-4 w-4 object-contain" />
      {rest}
    </span>
  );
}

/** A small gear in the team colour: Gearbox's mark. */
export function GearMark({ small = false }: { small?: boolean }) {
  const size = small ? 18 : 26;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#a32035"
        d="M10.3 1h3.4l.5 2.6c.7.2 1.4.5 2 .9l2.2-1.5 2.4 2.4-1.5 2.2c.4.6.7 1.3.9 2l2.6.5v3.4l-2.6.5c-.2.7-.5 1.4-.9 2l1.5 2.2-2.4 2.4-2.2-1.5c-.6.4-1.3.7-2 .9l-.5 2.6h-3.4l-.5-2.6c-.7-.2-1.4-.5-2-.9l-2.2 1.5-2.4-2.4 1.5-2.2c-.4-.6-.7-1.3-.9-2L1 13.7v-3.4l2.6-.5c.2-.7.5-1.4.9-2L3 5.6 5.4 3.2l2.2 1.5c.6-.4 1.3-.7 2-.9L10.3 1zM12 8a4 4 0 100 8 4 4 0 000-8z"
      />
    </svg>
  );
}
