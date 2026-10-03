import { wordmark } from "@g3/site-config";
import { AppNavBar, activePath, linkWith } from "@g3/ui";
import { Link, useLocation } from "react-router-dom";
import type { PluginNavItem } from "./plugin-types";
import { useAuth } from "./use-auth";

const routerLink = linkWith(Link);

/** The shared G3 top bar; pages that need a login or admin only show when they apply. */
export function NavBar({ items }: { items: PluginNavItem[] }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const shown = items.filter((item) => {
    if (item.requiresAdmin) return user?.isAdmin === true;
    if (item.requiresAuth) return user != null;
    return true;
  });
  const active = activePath(
    pathname,
    shown.map((item) => item.to),
  );
  return (
    <AppNavBar
      icon="/favicon.svg"
      title={wordmark("Pit")}
      link={routerLink}
      items={shown.map((item) => ({
        key: item.to,
        label: item.label,
        href: item.to,
        active: item.to === active,
      }))}
    />
  );
}
