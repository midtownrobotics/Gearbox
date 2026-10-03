import { appUrl, wordmark } from "@g3/site-config";
import { versionLabel } from "@g3/site-config/versions";
import { AppNavBar, activePath, linkWith } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { g3id } from "../lib/api";
import type { PluginNavItem } from "./plugin-types";

const G3ID_LOGIN = `${appUrl("id")}/login?redirect=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`;

const routerLink = linkWith(Link);

type Me = { displayName: string } | null;

function useMe(): Me | undefined {
  const [me, setMe] = useState<Me | undefined>(undefined);

  useEffect(() => {
    g3id.auth.me
      .$get()
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMe(data))
      .catch(() => setMe(null));
  }, []);

  return me;
}

/** The shared G3 top bar, with who's signed in. Gearbox is the app list, so no All Apps link. */
export function NavBar({ items }: { items: PluginNavItem[] }) {
  const me = useMe();
  const { pathname } = useLocation();
  const shown = items.filter((item) => !item.requiresAuth || me);
  const active = activePath(
    pathname,
    shown.map((item) => item.to),
  );
  return (
    <AppNavBar
      version={versionLabel("Gearbox")}
      title={wordmark("Gearbox")}
      link={routerLink}
      allApps={false}
      items={shown.map((item) => ({
        key: item.to,
        label: item.label,
        href: item.to,
        active: item.to === active,
      }))}
      actions={
        me === undefined ? null : me ? (
          <a className="g3-nav-text-link" href={`${appUrl("id")}/`}>
            Hello, {me.displayName}!
          </a>
        ) : (
          <a className="g3-nav-text-link" href={G3ID_LOGIN}>
            Log in
          </a>
        )
      }
    />
  );
}
