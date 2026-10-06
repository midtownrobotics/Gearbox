import { wordmark } from "@g3/site-config";
import { versionLabel } from "@g3/site-config/versions";
import { AppNavBar, activePath, linkWith } from "@g3/ui";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { matchMachineProcess } from "./derive";
import { exitKioskMode, kioskLogout } from "./kiosk";
import { processPath } from "./nav";
import type { PluginNavItem } from "./plugin-types";
import { useAuthUser, useKiosk } from "./use-auth";
import { useShopData } from "./use-shop-data";

const routerLink = linkWith(Link);

/** The shared G3 top bar. In kiosk mode: no pages, just the machine and Log Out. */
export function NavBar({ items }: { items: PluginNavItem[] }) {
  const kiosk = useKiosk();
  const user = useAuthUser();
  const { data } = useShopData();
  const { pathname } = useLocation();

  let logoHref = "/";
  if (kiosk.active && data && kiosk.machineName) {
    const machine = matchMachineProcess(data.processes, kiosk.machineName);
    if (machine) logoHref = processPath(machine.id);
  }

  const shown = kiosk.active ? [] : items;
  const active = activePath(
    pathname,
    shown.map((item) => item.to),
  );

  return (
    <AppNavBar
      version={versionLabel("Shop")}
      icon="/favicon.svg"
      title={wordmark("Shop")}
      homeHref={logoHref}
      link={routerLink}
      allApps={!kiosk.active}
      items={shown.map((item) => ({
        key: item.to,
        label: item.label,
        href: item.to,
        active: item.to === active,
      }))}
      actions={
        kiosk.active && (
          <>
            <KioskBadge machineName={kiosk.machineName} />
            {user?.displayName && (
              <p className="text-sm font-semibold text-steel-dark">{user.displayName}</p>
            )}
            <button
              type="button"
              onClick={() => kioskLogout()}
              className="text-sm font-semibold text-paper bg-crimson hover:bg-crimson-dark rounded-lg px-3.5 py-2 transition-colors"
            >
              Log Out
            </button>
          </>
        )
      }
    />
  );
}

function confirmExitKioskMode() {
  const answer = window.prompt(
    'Exiting kiosk mode is for admins only. You will need an admin login to exit.\n\nType "I understand" to continue.',
  );
  if (answer?.trim().toLowerCase() !== "i understand") return;
  exitKioskMode();
}

function KioskBadge({ machineName }: { machineName: string | null }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm font-semibold text-steel-dark bg-steel-tint border border-steel/40 hover:border-crimson/50 rounded-lg px-3.5 py-2 transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden />
        {machineName ?? "Kiosk"}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 bg-paper border border-steel/30 rounded-xl shadow-lg p-4 w-64 space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-steel">Machine</p>
            <p className="text-2xl font-display text-ink mt-1">{machineName ?? "Kiosk"}</p>
            <p className="text-xs text-steel mt-1">This device is in kiosk mode</p>
          </div>
          <button
            type="button"
            onClick={confirmExitKioskMode}
            className="w-full text-sm font-semibold text-crimson border border-crimson/50 hover:bg-crimson-tint rounded-lg px-3 py-2 transition-colors"
          >
            Exit Kiosk Mode
          </button>
        </div>
      )}
    </div>
  );
}
