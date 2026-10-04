import { appTitle, appUrl, idName, site, teamLinks } from "@g3/site-config";
import { useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { FaGithub, FaInstagram, FaSlack } from "react-icons/fa";
import edgeIcon from "../../assets/app-icons/edge.svg";
import idIcon from "../../assets/app-icons/id.svg";
import ordersIcon from "../../assets/app-icons/orders.svg";
import pitIcon from "../../assets/app-icons/pit.svg";
import scoutingIcon from "../../assets/app-icons/scouting.svg";
import shopIcon from "../../assets/app-icons/shop.svg";
import skillsIcon from "../../assets/app-icons/skills.svg";
import g3Logo from "../../assets/g3.png";
import { g3id } from "../../lib/api";
import { BlueAllianceIcon, FirstIcon, Match13Icon, StatboticsIcon } from "./link-icons";

// The team's apps show their own app icon. Other links are drawn to match it: a black tile with a white
// symbol, and a burgundy ↗ for sites outside G3. (`bg-black` isn't touched by dark mode.)
type App = {
  label: string;
  href: string;
  external?: boolean;
} & ({ tile: string } | { icon?: IconType; logoSrc?: string });

const APPS: App[] = [
  {
    label: idName,
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
    label: "Edge",
    href: appUrl("edge"),
    tile: edgeIcon,
  },
  {
    label: "Public Site",
    href: site.publicSiteUrl,
    logoSrc: g3Logo,
  },
  {
    label: "Slack",
    href: site.links.slack,
    icon: FaSlack,
    external: true,
  },
  {
    label: "GitHub",
    href: site.links.github,
    icon: FaGithub,
    external: true,
  },
  {
    label: "Instagram",
    href: site.links.instagram,
    icon: FaInstagram,
    external: true,
  },
  {
    label: "FRC-Events",
    href: teamLinks.frcEvents,
    icon: FirstIcon,
    external: true,
  },
  {
    label: "The Blue Alliance",
    href: teamLinks.blueAlliance,
    icon: BlueAllianceIcon,
    external: true,
  },
  {
    label: "Statbotics",
    href: teamLinks.statbotics,
    icon: StatboticsIcon,
    external: true,
  },
  {
    label: "match13",
    href: teamLinks.match13,
    icon: Match13Icon,
    external: true,
  },
];

type AuthState = "checking" | "authenticated" | "unauthenticated";

export function HomePage() {
  const [authState, setAuthState] = useState<AuthState>("checking");

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
              FRC Team {site.team.number}
            </p>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">{appTitle("Gearbox")}</h1>
            <p className="text-gray-600">FIRST Robotics Competition</p>
          </div>

          <div className="space-y-3 pt-6">
            <a
              href={`${appUrl("id")}/login?redirect=${encodeURIComponent(window.location.href)}`}
              className="block w-full px-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold transition-colors"
            >
              Sign In
            </a>
            <a
              href={site.publicSiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full px-6 py-3 rounded-lg bg-gray-300 hover:bg-gray-400 text-gray-900 font-semibold transition-colors"
            >
              Not a member? Visit public site
            </a>
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
            Team {site.team.number}
          </p>
          <h1 className="text-4xl font-bold text-gray-900">{appTitle("Gearbox")}</h1>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-5 gap-x-4 gap-y-8">
          {APPS.filter((app) => app.href).map((app) => {
            return (
              <a
                key={app.label}
                href={app.href}
                target={app.external ? "_blank" : undefined}
                rel={app.external ? "noopener noreferrer" : undefined}
                className="flex flex-col items-center gap-2 group"
              >
                {"tile" in app ? (
                  <img
                    src={app.tile}
                    alt=""
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
                        className="absolute top-1.5 right-2 text-[11px] font-bold leading-none text-[#A32035]"
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
