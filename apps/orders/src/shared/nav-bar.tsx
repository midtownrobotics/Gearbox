import { wordmark } from "@g3/site-config";
import { versionLabel } from "@g3/site-config/versions";
import { AppNavBar, activePath, linkWith } from "@g3/ui";
import { Link, useLocation } from "react-router-dom";
import { useAuthUser } from "./auth";
import type { PluginNavItem } from "./plugin-types";

const routerLink = linkWith(Link);

/** The shared G3 top bar with this app's pages; mentor pages only for mentors. */
export function NavBar({ items }: { items: PluginNavItem[] }) {
  const user = useAuthUser();
  const { pathname } = useLocation();
  const shown = items.filter((item) => !item.mentorOnly || user.isMentor);
  const active = activePath(
    pathname,
    shown.map((item) => item.to),
  );
  return (
    <AppNavBar
      version={versionLabel("Orders")}
      icon="/favicon.svg"
      title={wordmark("Orders")}
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
