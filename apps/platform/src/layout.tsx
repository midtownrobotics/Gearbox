import { site } from "@g3/site-config";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import g3Logo from "./assets/g3.png";
import { MyTeamButton } from "./team-pages";

// The platform's header and footer, shared by its pages.

/** The top bar, styled like every app's (nav-bar.css): the wordmark in the theme's accent. */
export function Header() {
  return (
    <header className="g3-nav is-flat">
      <div className="g3-nav-brand items-center gap-3">
        <Link to="/" className="g3-nav-wordmark">
          <img className="g3-nav-icon" src="/favicon.svg" alt="" />
          GEARBOX
        </Link>
        <ByTeam className="hidden sm:flex" />
      </div>
      <nav className="g3-nav-end">
        <a href="/#apps" className="g3-nav-text-link hidden md:block">
          Apps
        </a>
        <a href="/#demo" className="g3-nav-text-link hidden md:block">
          Demo
        </a>
        <a href="/#how" className="g3-nav-text-link hidden md:block">
          Set up
        </a>
        <a href="/#customize" className="g3-nav-text-link hidden md:block">
          Make it yours
        </a>
        <span className="text-sm">
          <MyTeamButton />
        </span>
        <Link
          to="/signup"
          className="hidden rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-500 sm:block"
        >
          Sign up your team
        </Link>
      </nav>
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

/** Gearbox's mark (the site's own icon, /favicon.svg). */
export function GearMark({ small = false }: { small?: boolean }) {
  const size = small ? 18 : 26;
  return <img src="/favicon.svg" width={size} height={size} alt="" aria-hidden="true" />;
}
