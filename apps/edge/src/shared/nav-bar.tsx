import { wordmark } from "@g3/site-config";
import { versionLabel } from "@g3/site-config/versions";
import { AppNavBar, activePath, linkWith } from "@g3/ui";
import { Link, useLocation } from "react-router-dom";
import { useAuthUser } from "./auth";
import type { PluginNavItem } from "./plugin-types";

const routerLink = linkWith(Link);

/** The shared G3 top bar, pages grouped by module; admin pages only for admins. */
export function NavBar({ items }: { items: PluginNavItem[] }) {
  const user = useAuthUser();
  const { pathname } = useLocation();
  const shown = items.filter((item) => !item.adminOnly || user.isAdmin);
  const active = activePath(
    pathname,
    shown.map((item) => item.to),
  );
  return (
    <AppNavBar
      version={versionLabel("Edge")}
      icon="/favicon.svg"
      title={wordmark("Edge")}
      link={routerLink}
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
