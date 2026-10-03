import { useEffect, useState } from "react";
import type { IconType } from "react-icons";
import { FaChartLine, FaGithub, FaInstagram, FaSlack, FaTrophy } from "react-icons/fa";
import edgeIcon from "../../assets/app-icons/edge.svg";
import idIcon from "../../assets/app-icons/id.svg";
import ordersIcon from "../../assets/app-icons/orders.svg";
import pitIcon from "../../assets/app-icons/pit.svg";
import scoutingIcon from "../../assets/app-icons/scouting.svg";
import shopIcon from "../../assets/app-icons/shop.svg";
import skillsIcon from "../../assets/app-icons/skills.svg";
import g3Logo from "../../assets/g3.png";
import { g3id } from "../../lib/api";

// G3 apps show their own app icon. Other links are drawn to match it: a black tile with a white
// symbol, and a burgundy ↗ for sites outside G3. (`bg-black` isn't touched by dark mode.)
type App = {
  label: string;
  href: string;
  external?: boolean;
} & ({ tile: string } | { icon?: IconType; logoSrc?: string });

const APPS: App[] = [
  {
    label: "G3ID",
    href: "https://g3id.g3robotics.com",
    tile: idIcon,
  },
  {
    label: "Shop",
    href: "https://shop.g3robotics.com",
    tile: shopIcon,
  },
  {
    label: "Pit",
    href: "https://pit.g3robotics.com",
    tile: pitIcon,
  },
  {
    label: "Skill Tree",
    href: "https://skilltree.g3robotics.com",
    tile: skillsIcon,
  },
  {
    label: "Scouting",
    href: "https://scouting.g3robotics.com",
    tile: scoutingIcon,
  },
  {
    label: "Orders",
    href: "https://orders.g3robotics.com",
    tile: ordersIcon,
  },
  {
    label: "Edge",
    href: "https://edge.g3robotics.com",
    tile: edgeIcon,
  },
  {
    label: "Public Site",
    href: "https://www.g3robotics.com",
    logoSrc: g3Logo,
  },
  {
    label: "Slack",
    href: "https://g3robotics.slack.com",
    icon: FaSlack,
    external: true,
  },
  {
    label: "The Blue Alliance",
    href: "https://www.thebluealliance.com/team/1648",
    icon: FaTrophy,
    external: true,
  },
  {
    label: "Statbotics",
    href: "https://www.statbotics.io/team/1648",
    icon: FaChartLine,
    external: true,
  },
  {
    label: "GitHub",
    href: "https://github.com/midtownrobotics",
    icon: FaGithub,
    external: true,
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/g3robotics1648/",
    icon: FaInstagram,
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
              FRC Team 1648
            </p>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">G3 Gearbox</h1>
            <p className="text-gray-600">FIRST Robotics Competition</p>
          </div>

          <div className="space-y-3 pt-6">
            <a
              href={`https://g3id.g3robotics.com/login?redirect=${encodeURIComponent(window.location.href)}`}
              className="block w-full px-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold transition-colors"
            >
              Sign In
            </a>
            <a
              href="https://g3robotics.com"
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
            Team 1648
          </p>
          <h1 className="text-4xl font-bold text-gray-900">G3 Gearbox</h1>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-5 gap-x-4 gap-y-8">
          {APPS.map((app) => {
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
