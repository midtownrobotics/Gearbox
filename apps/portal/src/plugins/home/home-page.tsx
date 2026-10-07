import { type TeamUiLinkKey, appUrl, pageTeamNumber } from "@g3/site-config";
import { TeamIcon, useTeamNames, useTeamUiSettings } from "@g3/ui";
import { useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { FaGithub, FaGlobe, FaInstagram, FaSlack } from "react-icons/fa";
import edgeIcon from "../../assets/app-icons/edge.svg";
import idIcon from "../../assets/app-icons/id.svg";
import inventoryIcon from "../../assets/app-icons/inventory.svg";
import ordersIcon from "../../assets/app-icons/orders.svg";
import pitIcon from "../../assets/app-icons/pit.svg";
import scoutingIcon from "../../assets/app-icons/scouting.svg";
import shopIcon from "../../assets/app-icons/shop.svg";
import skillsIcon from "../../assets/app-icons/skills.svg";
import { g3id } from "../../lib/api";
import { BlueAllianceIcon, FirstIcon, Match13Icon, StatboticsIcon } from "./link-icons";

// The team's apps show their own app icon, its accent in the team's primary colour (TeamIcon).
// Other links are drawn to match it: a black tile with a white symbol, and a ↗ in that colour for
// sites outside the team's apps. (`bg-black` isn't touched by dark mode, and neither is the
// colour variable used directly, where the `text-primary-500` class would be lightened.)
type App = {
  label: string;
  href: string;
  external?: boolean;
  linkKey?: TeamUiLinkKey;
} & ({ tile: string } | { icon?: IconType; logoSrc?: string });

const APPS: App[] = [
  {
    // The sign-in app: named after the team ("G3ID") below.
    label: "ID",
    href: appUrl("id"),
    tile: idIcon,
  },
  {
    label: "Shop",
    href: appUrl("shop"),
    tile: shopIcon,
  },
  {
    label: "Pit",
    href: appUrl("pit"),
    tile: pitIcon,
  },
  {
    label: "Skill Tree",
    href: appUrl("skillTree"),
    tile: skillsIcon,
  },
  {
    label: "Scouting",
    href: appUrl("scouting"),
    tile: scoutingIcon,
  },
  {
    label: "Orders",
    href: appUrl("orders"),
    tile: ordersIcon,
  },
  {
    label: "Inventory",
    href: appUrl("inventory"),
    tile: inventoryIcon,
  },
  {
    label: "Edge",
    href: appUrl("edge"),
    tile: edgeIcon,
  },
  {
    label: "Public Site",
    linkKey: "publicSite",
    href: "",
    icon: FaGlobe,
  },
  {
    label: "Slack",
    linkKey: "slack",
    href: "",
    icon: FaSlack,
    external: true,
  },
  {
    label: "GitHub",
    linkKey: "github",
    href: "",
    icon: FaGithub,
    external: true,
  },
  {
    label: "Instagram",
    linkKey: "instagram",
    href: "",
    icon: FaInstagram,
    external: true,
  },
  {
    label: "FRC-Events",
    linkKey: "frcEvents",
    href: "",
    icon: FirstIcon,
    external: true,
  },
  {
    label: "The Blue Alliance",
    linkKey: "blueAlliance",
    href: "",
    icon: BlueAllianceIcon,
    external: true,
  },
  {
    label: "Statbotics",
    linkKey: "statbotics",
    href: "",
    icon: StatboticsIcon,
    external: true,
  },
  {
    label: "match13",
    linkKey: "match13",
    href: "",
    icon: Match13Icon,
    external: true,
  },
];

/** The public site's tile: the team's logo (Team Appearance), or a globe until it sets one. */
function publicSiteMark(logoUrl: string): { logoSrc?: string; icon?: IconType } {
  return logoUrl ? { logoSrc: logoUrl } : { logoSrc: undefined, icon: FaGlobe };
}

type AuthState = "checking" | "authenticated" | "unauthenticated";

export function HomePage() {
  const teamUi = useTeamUiSettings();
  const names = useTeamNames();
  const [authState, setAuthState] = useState<AuthState>("checking");
  const apps = APPS.map((app) => {
    if (app.label === "ID") return { ...app, label: names.idName };
    if (!app.linkKey) return app;
    return {
      ...app,
      // The team's own links (Team Appearance); a link it hasn't set is left out.
      href: teamUi.links[app.linkKey] ?? "",
      ...(app.linkKey === "publicSite" ? publicSiteMark(teamUi.logoUrl) : {}),
    };
  });

  useEffect(() => {
    g3id.auth.me.$get().then(async (res) => {
      if (res.ok) {
        setAuthState("authenticated");
      } else {
        setAuthState("unauthenticated");
      }
    });
  }, []);

  if (authState === "checking") {
    return (
      <main className="min-h-screen bg-page flex items-center justify-center px-6">
        <div className="text-center">
          <div className="animate-pulse">
            <p className="text-red-600 font-semibold text-lg tracking-widest uppercase">
              Loading...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (authState === "unauthenticated") {
    return (
      <main className="min-h-screen bg-page flex items-center justify-center px-6">
        <div className="max-w-md w-full space-y-6 text-center">
          <div>
            <p className="text-red-600 font-semibold text-lg tracking-widest uppercase mb-2">
              FRC Team {pageTeamNumber}
            </p>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">{teamUi.shortName} Gearbox</h1>
            <p className="text-gray-600">FIRST Robotics Competition</p>
          </div>

          <div className="space-y-3 pt-6">
            <a
              href={`${appUrl("id")}/login?redirect=${encodeURIComponent(window.location.href)}`}
              className="block w-full px-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold transition-colors"
            >
              Sign In
            </a>
            {teamUi.links.publicSite && !teamUi.hiddenLinks?.includes("publicSite") && (
              <a
                href={teamUi.links.publicSite}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full px-6 py-3 rounded-lg bg-gray-300 hover:bg-gray-400 text-gray-900 font-semibold transition-colors"
              >
                Not a member? Visit public site
              </a>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="mb-10">
          <p className="text-red-600 text-sm font-semibold uppercase tracking-widest mb-1">
            Team {pageTeamNumber}
          </p>
          <h1 className="text-4xl font-bold text-gray-900">{teamUi.shortName} Gearbox</h1>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-5 gap-x-4 gap-y-8">
          {apps
            .filter(
              (app) => app.href && (!app.linkKey || !teamUi.hiddenLinks?.includes(app.linkKey)),
            )
            .map((app) => {
              return (
                <a
                  key={app.label}
                  href={app.href}
                  target={app.external ? "_blank" : undefined}
                  rel={app.external ? "noopener noreferrer" : undefined}
                  className="flex flex-col items-center gap-2 group"
                >
                  {"tile" in app ? (
                    <TeamIcon
                      src={app.tile}
                      className="w-16 h-16 shadow-lg rounded-[14px] transition-transform duration-150 group-hover:scale-110"
                    />
                  ) : (
                    <div className="relative w-16 h-16 rounded-[14px] bg-black flex items-center justify-center shadow-lg transition-transform duration-150 group-hover:scale-110">
                      {app.logoSrc ? (
                        <img src={app.logoSrc} alt="" className="w-11 h-11 object-contain" />
                      ) : app.icon ? (
                        <span className="text-white text-[34px]">
                          <app.icon />
                        </span>
                      ) : null}
                      {app.external && (
                        <span
                          className="absolute top-1.5 right-2 text-[11px] font-bold leading-none text-[var(--color-primary-500)]"
                          aria-hidden
                        >
                          ↗
                        </span>
                      )}
                    </div>
                  )}
                  <span className="text-xs text-center leading-tight transition-colors text-gray-600 group-hover:text-gray-900">
                    {app.label}
                  </span>
                </a>
              );
            })}
        </div>
      </div>
    </main>
  );
}
