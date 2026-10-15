import { wordmark } from "@g3/site-config";
import { versionLabel } from "@g3/site-config/versions";
import { AppNavBar, activePath, linkWith } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import type { PluginNavItem } from "./plugin-types";

const routerLink = linkWith(Link);

/**
 * The shared top bar. ID only signs people in: signed out, Sign in and Sign up; signed in, the
 * greeting (to the account page on the team's home) and the team's apps in the menu.
 */
export function NavBar({ items }: { items: PluginNavItem[] }) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const location = useLocation();

  // biome-ignore lint/correctness/useExhaustiveDependencies: location is used to trigger re-fetch on navigation
  useEffect(() => {
    api.auth.me.$get().then((res) => setIsLoggedIn(res.ok));
  }, [location]);

  const shown = items.filter((item) => {
    if (isLoggedIn === null) return false; // Loading
    return (item.audience ?? "signed-in") === "signed-out" ? !isLoggedIn : isLoggedIn;
  });
  const active = activePath(
    location.pathname,
    shown.map((item) => item.to),
  );

  return (
    <AppNavBar
      version={versionLabel("ID")}
      title={wordmark("ID")}
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
