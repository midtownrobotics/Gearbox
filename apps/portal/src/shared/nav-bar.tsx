import { apiPath, appUrl, wordmark } from "@g3/site-config";
import { versionLabel } from "@g3/site-config/versions";
import { AppNavBar, activePath, linkWith, useTeamApps } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMe } from "./me";
import type { PluginNavItem } from "./plugin-types";

const G3ID_LOGIN = `${appUrl("id")}/login?redirect=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`;

const routerLink = linkWith(Link);

/** The shared G3 top bar; signed out, it offers Sign in. */
export function NavBar({ items }: { items: PluginNavItem[] }) {
  const me = useMe();
  const { pathname } = useLocation();
  const teamApps = useTeamApps(Boolean(me));
  const [attendanceAccess, setAttendanceAccess] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh delegated access on navigation
  useEffect(() => {
    let active = true;
    fetch(`${apiPath("id")}/auth/me?app=attendance&includeIdentities=false`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const user = data as {
          isAdmin?: boolean;
          permissions?: string[];
          sessionType?: string;
        } | null;
        if (active)
          setAttendanceAccess(
            user?.sessionType !== "pin" &&
              Boolean(user?.isAdmin || user?.permissions?.includes("manage")),
          );
      })
      .catch(() => {
        if (active) setAttendanceAccess(false);
      });
    return () => {
      active = false;
    };
  }, [pathname]);
  const shown = items.filter(
    (item) =>
      (!item.requiresAuth || me) &&
      (!item.requiresAdmin || me?.isAdmin) &&
      (!item.requiresApp || !(teamApps instanceof Set) || teamApps.has(item.requiresApp)) &&
      (!item.permission || me?.isAdmin || attendanceAccess),
  );
  const active = activePath(
    pathname,
    shown.map((item) => item.to),
  );
  return (
    <AppNavBar
      version={versionLabel("Portal")}
      title={wordmark("Gearbox")}
      icon="/favicon.svg"
      link={routerLink}
      items={shown.map((item) => ({
        key: item.to,
        label: item.label,
        href: item.to,
        active: item.to === active,
        group: item.group,
      }))}
      actions={
        me === null && (
          <a className="g3-nav-text-link" href={G3ID_LOGIN}>
            Sign in
          </a>
        )
      }
    />
  );
}
