import { wordmark } from "@g3/site-config";
import { versionLabel } from "@g3/site-config/versions";
import { AppNavBar, activePath, linkWith } from "@g3/ui";
import { Link, useLocation } from "react-router-dom";
import { useAuthUser } from "./auth";
import type { Access, PluginNavItem } from "./plugin-types";

const routerLink = linkWith(Link);

/** The shared top bar with this app's pages: each only for the people who can use it. */
export function NavBar({ items }: { items: PluginNavItem[] }) {
  const user = useAuthUser();
  const { pathname } = useLocation();
  const allowed: Record<Access, boolean> = {
    everyone: true,
    editor: user.canEdit,
    mentor: user.isMentor,
  };
  const shown = items.filter((item) => allowed[item.access ?? "everyone"]);
  const active = activePath(
    pathname,
    shown.map((item) => item.to),
  );
  return (
    <AppNavBar
      version={versionLabel("Schedule")}
      icon="/favicon.svg"
      title={wordmark("Schedule")}
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
