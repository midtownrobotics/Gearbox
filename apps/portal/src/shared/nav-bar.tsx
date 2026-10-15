import { wordmark } from "@g3/site-config";
import { versionLabel } from "@g3/site-config/versions";
import { AppNavBar, activePath, linkWith } from "@g3/ui";
import { Link, useLocation } from "react-router-dom";
import { useMe } from "./me";
import type { PluginNavItem } from "./plugin-types";

const routerLink = linkWith(Link);

/** The shared top bar with Portal's pages. */
export function NavBar({ items }: { items: PluginNavItem[] }) {
  const me = useMe();
  const { pathname } = useLocation();
  const shown = items.filter(
    (item) => (!item.requiresAuth || me) && (!item.requiresAdmin || me?.isAdmin),
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
    />
  );
}
