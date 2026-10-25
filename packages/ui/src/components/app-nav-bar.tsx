import {
  type AppName,
  allAppsUrl,
  appUrl,
  completeAppOrder,
  helpDocFor,
  helpUrl,
  isDemoPage,
  platformUrl,
  portalAppLabels,
  site,
} from "@g3/site-config";
import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import { useSignedInUser, useTeamApps } from "../session";
import { usePageTeamAvatar, useTeamIcon, useTeamUiSettings } from "../team-ui";
import { useTheme } from "../theme";
import {
  type TutorialDocMessage,
  handOffDoc,
  lockPageScroll,
  navigateInApp,
  setTutorial,
  useTutorial,
  useTutorialFits,
} from "../tutorial";
import { ReportDialog } from "./report-dialog";
import { TutorialPanel } from "./tutorial-panel";

// The top bar every G3 app shares (from Scouting's): the menu button, the app's wordmark, its
// pages, who's signed in and the light/dark switch. The menu (a drawer) lists the team's apps
// under "All Apps"; below 768px the pages move into it too, above them. Its foot has "Report a
// problem" for anyone signed in (ReportDialog), "Need help?" and, on a computer, Tutorial mode
// (TutorialPanel: the docs beside the app). It has its own CSS (nav-bar.css), so it looks the
// same in apps that don't use Tailwind.

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
  account = true,
  signedIn,
  version,
  team = true,
  iconIsLogo = false,
}: {
  /** The app's wordmark, e.g. wordmark("Shop") from @g3/site-config. */
  title: string;
  /** The app's icon (its tab icon, e.g. "/favicon.svg"), shown before the wordmark. */
  icon?: string;
  /**
   * `icon` is a team's logo (any shape) rather than a square app icon, so it keeps its
   * proportions. The bar knows this itself for the team's logo from Team Appearance.
   */
  iconIsLogo?: boolean;
  homeHref?: string;
  items: AppNavItem[];
  link?: AppNavLink;
  /** Extra controls on the right (kiosk badge, Log in); also at the bottom of the drawer. */
  actions?: ReactNode;
  /** List the team's apps in the menu, under "All Apps". Off where people shouldn't leave (a kiosk). */
  allApps?: boolean;
  /** Greet whoever is signed in, with a link to their account (ID). Never for a kiosk PIN session. */
  account?: boolean;
  /**
   * For an app that signs people in and out without reloading (ID): what it knows, null while
   * it's finding out. Other apps leave it out, and the bar asks.
   */
  signedIn?: boolean | null;
  /** "Orders 1.4.0 · platform 2026.10.0": on the wordmark's tooltip and in the drawer. */
  version?: string;
  /**
   * Off for the platform's own pages (the operators' console), which belong to no team: built-in
   * colors and icon, no team name, no app list and no greeting, and nothing is asked of ID.
   */
  team?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const teamUi = useTeamUiSettings(team);
  const brandedTitle = team
    ? title.replace(new RegExp(`^${site.team.shortName}\\b`, "i"), teamUi.shortName)
    : title;
  const user = useSignedInUser(team ? signedIn : false);
  const enabled = useTeamApps(allApps && !!user);
  // The app's icon, with its accent in the team's color.
  const teamIcon = useTeamIcon(team ? icon : undefined);
  // The team's avatar in its place, when the team shows it (Team Appearance) and has one.
  const avatar = usePageTeamAvatar(team);
  const shownIcon = team ? avatar || teamIcon : icon;
  const shownLogo = team ? !!avatar : iconIsLogo;
  // Which logo has loaded wider than it is tall: only a wide one narrows when the bar is short of
  // room (a square or tall one is no wider than the icon already).
  const [wideLogo, setWideLogo] = useState<string | null>(null);
  const iconClass = shownLogo
    ? `g3-nav-icon is-logo${wideLogo === shownIcon ? " is-wide" : ""}`
    : "g3-nav-icon";

  // The team's home, then its apps that are on, in the order of the home's grid.
  const here = typeof window === "undefined" ? "" : window.location.host;
  const appLinks: { key: string; label: string; href: string }[] =
    allApps && user
      ? [
          { key: "portal", label: "Portal", href: allAppsUrl },
          ...(enabled
            ? completeAppOrder(teamUi.appOrder ?? [])
                .filter((key): key is keyof typeof portalAppLabels => key in portalAppLabels)
                .filter((key) => enabled === "all" || enabled.has(key))
                .map((key) => ({
                  key,
                  label: portalAppLabels[key],
                  href: appUrl(key),
                }))
            : []),
        ]
      : [];
  // "Need help?": the doc about this page, else the app's front page in the docs
  // (`helpUrl`, from each doc's `pages:`). Worked out as the bar draws, so it follows the page.
  const thisApp = appLinks.find((app) => new URL(app.href, window.location.href).host === here);
  const help = team ? helpUrl(window.location.pathname, thisApp?.key as AppName | undefined) : null;
  // Tutorial mode: the same docs page beside the app, on a wide enough window, never on a
  // screen that keeps people in one app (a kiosk).
  const tutorialOn = useTutorial();
  const tutorialFits = useTutorialFits();
  const canTutorial = !!help && allApps && tutorialFits;
  // A page the reader opens in the panel: go to the app page it's about, unless this page is one
  // it's about already. Another app's page opens that app (where tutorial mode stays on); an app
  // the team has off, or a doc about no app page (Getting started), leaves the app as it is.
  const followDoc = (doc: TutorialDocMessage) => {
    if (!doc.app || !doc.path) return;
    const here = helpDocFor(window.location.pathname);
    if (here?.section === doc.section) {
      if (here.slug !== doc.slug) navigateInApp(doc.path);
      return;
    }
    const target = appLinks.find((app) => app.key === doc.app);
    if (!target) return;
    handOffDoc(doc.pathname);
    window.location.assign(new URL(doc.path, target.href).href);
  };
  // Reports go to Gearbox's public GitHub: never from the demo, whose text stays on the page.
  const canReport = team && !!user && !isDemoPage;
  // Whether the bar has an app list to offer (or may, while it's being asked).
  const hasApps = allApps && user !== null;
  // With no pages and no apps there's nothing for a menu; the bar keeps its controls on phones too.
  const flat = items.length === 0 && !hasApps;
  const hello =
    account && user && !user.kiosk ? (
      <a className="g3-nav-text-link g3-nav-hello" href={`${appUrl("portal")}/account`}>
        Hello, {user.displayName}!
      </a>
    ) : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const unlock = lockPageScroll();
    return () => {
      window.removeEventListener("keydown", onKey);
      unlock();
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
            {shownIcon && (
              <img
                className={iconClass}
                src={shownIcon}
                alt=""
                onLoad={(e) => {
                  const { naturalWidth, naturalHeight } = e.currentTarget;
                  if (naturalWidth > naturalHeight) setWideLogo(shownIcon);
                }}
              />
            )}
            <span className="g3-nav-title">{brandedTitle}</span>
          </>
        ),
      })}
    </span>
  );

  return (
    <>
      {isDemoPage && (
        <div className="g3-demo-banner" role="note">
          <span>
            This is the public demo. Everything resets at midnight Eastern, and anyone can see what
            you change.
          </span>
          <span className="g3-demo-banner-links">
            <a href={`${appUrl("id")}/demo`}>Switch role</a>
            <a href={platformUrl}>Back to Gearbox</a>
          </span>
        </div>
      )}
      <header className={`g3-nav${flat ? " is-flat" : ""}${hasApps ? " has-apps" : ""}`}>
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
          {hello}
          <ThemeToggle />
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
          <nav className="g3-nav-drawer-links" aria-label="Menu">
            {/* The pages are only here on a phone: a wide bar has them across the top. */}
            {groups.map(([name, groupItems], i) => (
              <div key={name || i} className="g3-nav-drawer-group g3-nav-drawer-pages">
                {groupItems.map((item) => renderItem(item, true))}
              </div>
            ))}
            {appLinks.length > 0 && (
              <div className="g3-nav-drawer-group g3-nav-drawer-apps">
                <span className="g3-nav-drawer-title">All Apps</span>
                {appLinks.map((app) => {
                  const current = new URL(app.href, window.location.href).host === here;
                  return (
                    <a
                      key={app.key}
                      className={`g3-nav-link${current ? " is-active" : ""}`}
                      href={app.href}
                      aria-current={current ? "page" : undefined}
                    >
                      {app.label}
                    </a>
                  );
                })}
              </div>
            )}
          </nav>
          <div className="g3-nav-drawer-foot">
            {actions && <div className="g3-nav-actions">{actions}</div>}
            <ThemeToggle labeled />
            {help && (
              <a className="g3-nav-text-link" href={help} target="_blank" rel="noreferrer">
                Need help?
              </a>
            )}
            {canTutorial && (
              <button
                type="button"
                className="g3-nav-text-link g3-nav-report"
                onClick={() => {
                  setOpen(false);
                  setTutorial(!tutorialOn);
                }}
              >
                {tutorialOn ? "Close tutorial" : "Tutorial mode"}
              </button>
            )}
            {canReport && (
              <button
                type="button"
                className="g3-nav-text-link g3-nav-report"
                onClick={() => {
                  setOpen(false);
                  setReporting(true);
                }}
              >
                Report a problem
              </button>
            )}
            {version && <span className="g3-nav-version">{version}</span>}
          </div>
        </div>
      )}
      {reporting && <ReportDialog version={version} onClose={() => setReporting(false)} />}
      {canTutorial && tutorialOn && help && (
        <TutorialPanel
          src={help}
          apps={enabled instanceof Set ? ["portal", ...enabled] : null}
          role={user ? (user.isAdmin ? "admin" : user.isMentor ? "mentor" : "member") : null}
          onDocPage={followDoc}
        />
      )}
    </>
  );
}

/** Switches light/dark for every G3 app. */
export function ThemeToggle({ labeled = false }: { labeled?: boolean }) {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "Dark mode" : "Light mode";
  return (
    <button
      type="button"
      className={`g3-nav-theme${labeled ? " is-labeled" : ""}`}
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
