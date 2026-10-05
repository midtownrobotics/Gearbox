import { allAppsUrl, site } from "@g3/site-config";
import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import { useTeamUiSettings } from "../team-ui";
import { useTheme } from "../theme";

// The top bar every G3 app shares (from G3 Strategy's): the app's wordmark, its pages, the
// light/dark switch and All Apps. Below 768px the pages move into a drawer. It has its own CSS
// (nav-bar.css), so it looks the same in apps that don't use Tailwind.

export type AppNavItem = {
  /** Unique within the bar (usually the path). */
  key: string;
  label: ReactNode;
  /** Where the item goes. Items with `onSelect` instead act like buttons. */
  href?: string;
  onSelect?: () => void;
  active?: boolean;
  /** Items with the same group are shown together under its name. */
  group?: string;
};

/** Renders an in-app link (e.g. react-router's `Link`); plain `<a>` when not given. */
export type AppNavLink = (props: {
  href: string;
  className: string;
  title?: string;
  onClick?: () => void;
  "aria-current"?: "page";
  children: ReactNode;
}) => ReactNode;

/** The app list (from @g3/site-config). */
export const ALL_APPS_URL = allAppsUrl;

/** An AppNavLink from a router's link component, e.g. `linkWith(Link)` for react-router. */
export function linkWith(
  Link: ComponentType<{
    to: string;
    className: string;
    title?: string;
    onClick?: () => void;
    "aria-current"?: "page";
    children: ReactNode;
  }>,
): AppNavLink {
  return ({ href, children, ...props }) => (
    <Link to={href} {...props}>
      {children}
    </Link>
  );
}

/** Whether a link covers the current page: its own path or a page under it. */
export function isActivePath(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** The link for the current page: the most specific one covering it ("/print/printers" over "/print"). */
export function activePath(pathname: string, paths: string[]): string | undefined {
  return paths.filter((to) => isActivePath(pathname, to)).sort((a, b) => b.length - a.length)[0];
}

const plainLink: AppNavLink = ({ href, children, ...props }) => (
  <a href={href} {...props}>
    {children}
  </a>
);

export function AppNavBar({
  title,
  icon,
  homeHref = "/",
  items,
  link = plainLink,
  actions,
  allApps = true,
  version,
}: {
  /** The app's wordmark, e.g. wordmark("Shop") from @g3/site-config. */
  title: string;
  /** The app's icon (its tab icon, e.g. "/favicon.svg"), shown before the wordmark. */
  icon?: string;
  homeHref?: string;
  items: AppNavItem[];
  link?: AppNavLink;
  /** Extra controls on the right (user, kiosk badge); also at the bottom of the drawer. */
  actions?: ReactNode;
  /** Show the All Apps link. */
  allApps?: boolean;
  /** "Orders 1.4.0 · platform 2026.10.0": on the wordmark's tooltip and in the drawer. */
  version?: string;
}) {
  const [open, setOpen] = useState(false);
  const teamUi = useTeamUiSettings();
  const brandedTitle = title.replace(
    new RegExp(`^${site.team.shortName}(?=\\b|ID)`, "i"),
    teamUi.shortName,
  );
  // With no pages there's nothing for a menu; the bar keeps its controls on phones too.
  const flat = items.length === 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const groups: [string, AppNavItem[]][] = [];
  for (const item of items) {
    const name = item.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last[0] === name) last[1].push(item);
    else groups.push([name, [item]]);
  }

  const renderItem = (item: AppNavItem, close: boolean) => {
    const className = `g3-nav-link${item.active ? " is-active" : ""}`;
    const onClick = close ? () => setOpen(false) : undefined;
    if (item.onSelect) {
      const select = item.onSelect;
      return (
        <button
          key={item.key}
          type="button"
          className={className}
          aria-current={item.active ? "page" : undefined}
          onClick={() => {
            select();
            setOpen(false);
          }}
        >
          {item.label}
        </button>
      );
    }
    return (
      <span key={item.key} className="g3-nav-item">
        {link({
          href: item.href ?? "#",
          className,
          onClick,
          "aria-current": item.active ? "page" : undefined,
          children: item.label,
        })}
      </span>
    );
  };

  const brand = (
    <span className="g3-nav-brand">
      {link({
        href: homeHref,
        className: "g3-nav-wordmark",
        title: version,
        onClick: () => setOpen(false),
        children: (
          <>
            {(teamUi.logoUrl || icon) && (
              <img className="g3-nav-icon" src={teamUi.logoUrl || icon} alt="" />
            )}
            {brandedTitle}
          </>
        ),
      })}
    </span>
  );

  return (
    <>
      <header className={`g3-nav${flat ? " is-flat" : ""}`}>
        {!flat && (
          <button
            type="button"
            className="g3-nav-menu"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <MenuIcon />
          </button>
        )}
        {brand}
        <nav className="g3-nav-links" aria-label="Pages">
          {groups.map(([name, groupItems], i) => (
            <div key={name || i} className="g3-nav-group">
              {name && <span className="g3-nav-group-name">{name}</span>}
              {groupItems.map((item) => renderItem(item, false))}
            </div>
          ))}
        </nav>
        <div className="g3-nav-end">
          {actions && <div className="g3-nav-actions">{actions}</div>}
          <ThemeToggle />
          {allApps && (
            <a className="g3-nav-all-apps" href={ALL_APPS_URL}>
              All Apps
            </a>
          )}
        </div>
      </header>

      {open && !flat && (
        <button
          type="button"
          className="g3-nav-scrim"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      )}
      {!flat && (
        <div className={`g3-nav-drawer${open ? " is-open" : ""}`} inert={!open}>
          <div className="g3-nav-drawer-head">
            {brand}
            <button
              type="button"
              className="g3-nav-menu"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              <CloseIcon />
            </button>
          </div>
          <nav className="g3-nav-drawer-links" aria-label="Pages">
            {groups.map(([name, groupItems], i) => (
              <div key={name || i} className="g3-nav-drawer-group">
                {groupItems.map((item) => renderItem(item, true))}
              </div>
            ))}
          </nav>
          <div className="g3-nav-drawer-foot">
            {actions && <div className="g3-nav-actions">{actions}</div>}
            <ThemeToggle labelled />
            {allApps && (
              <a className="g3-nav-all-apps" href={ALL_APPS_URL}>
                All Apps
              </a>
            )}
            {version && <span className="g3-nav-version">{version}</span>}
          </div>
        </div>
      )}
    </>
  );
}

/** Switches light/dark for every G3 app. */
export function ThemeToggle({ labelled = false }: { labelled?: boolean }) {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "Dark mode" : "Light mode";
  return (
    <button
      type="button"
      className={`g3-nav-theme${labelled ? " is-labelled" : ""}`}
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {next === "dark" ? <MoonIcon /> : <SunIcon />}
      <span className="g3-nav-theme-label">{label}</span>
    </button>
  );
}

const iconProps = {
  width: 17,
  height: 17,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function MoonIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg {...iconProps} width={22} height={22} aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...iconProps} width={20} height={20} aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
