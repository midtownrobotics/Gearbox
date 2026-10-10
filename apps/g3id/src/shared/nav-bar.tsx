import { idName } from "@g3/site-config";
import { versionLabel } from "@g3/site-config/versions";
import { AppNavBar, activePath, linkWith } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import type { PluginNavItem } from "./plugin-types";

const routerLink = linkWith(Link);

/**
 * The shared G3 top bar. Signed out: Log in and Sign up. Signed in: Dash and Leaderboard, the
 * Admin pages for admins, and the team's apps in the menu.
 */
export function NavBar({ items }: { items: PluginNavItem[] }) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const location = useLocation();

  // biome-ignore lint/correctness/useExhaustiveDependencies: location is used to trigger re-fetch on navigation
  useEffect(() => {
    api.auth.me.$get().then(async (res) => {
      if (res.ok) {
        const data = (await res.json()) as { isAdmin?: boolean };
        setIsLoggedIn(true);
        setIsAdmin(data.isAdmin ?? false);
      } else {
        setIsLoggedIn(false);
        setIsAdmin(false);
      }
    });
  }, [location]);

  const shown = items.filter((item) => {
    if (isLoggedIn === null) return false; // Loading
    const audience = item.audience ?? "signed-in";
    if (audience === "signed-out") return !isLoggedIn;
    if (audience === "admin") return isLoggedIn && isAdmin;
    return isLoggedIn;
  });
  // The dashboard is the home page and also lives at /dashboard.
  const path = location.pathname === "/dashboard" ? "/" : location.pathname;
  const active = activePath(
    path,
    shown.map((item) => item.to),
  );

  return (
    <AppNavBar
      version={versionLabel(idName)}
      title={idName}
      icon="/favicon.svg"
      link={routerLink}
      allApps={isLoggedIn === true}
      signedIn={isLoggedIn}
      items={shown.map((item) => ({
        key: item.to,
        label: item.label,
        href: item.to,
        group: item.group,
        active: item.to === active,
      }))}
    />
  );
}
