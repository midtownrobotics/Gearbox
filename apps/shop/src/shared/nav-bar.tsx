import { wordmark } from "@g3/site-config";
import { versionLabel } from "@g3/site-config/versions";
import { AppNavBar, Button, Dialog, Field, activePath, inputClass, linkWith } from "@g3/ui";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { matchMachineProcess } from "./derive";
import { exitKioskMode, kioskLogout } from "./kiosk";
import { processPath } from "./nav";
import type { PluginNavItem } from "./plugin-types";
import { useAuthUser, useKiosk } from "./use-auth";
import { useShopData } from "./use-shop-data";

const routerLink = linkWith(Link);

/** The shared G3 top bar. In kiosk mode: no pages, just the machine and Sign out. */
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
      account={!kiosk.active}
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
              <p className="text-sm font-semibold text-secondary-500">{user.displayName}</p>
            )}
            <Button onClick={() => kioskLogout()}>Sign out</Button>
          </>
        )
      }
    />
  );
}

/** Leaving kiosk mode asks first: it signs the device out, and only an admin can sign back in. */
function ExitKioskDialog({ onClose }: { onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const understood = typed.trim().toLowerCase() === "i understand";
  return (
    <Dialog title="Exit kiosk mode" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (understood) exitKioskMode();
        }}
      >
        <p className="text-sm text-secondary-600">
          Only a trusted student can exit kiosk mode. You'll be asked to sign in as one.
        </p>
        <Field label='Type "I understand" to continue'>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className={inputClass}
            // biome-ignore lint/a11y/noAutofocus: the pop-up was just opened to type this
            autoFocus
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="danger" disabled={!understood}>
            Exit kiosk mode
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Stay in kiosk mode
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function KioskBadge({ machineName }: { machineName: string | null }) {
  const [open, setOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
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
        className="flex items-center gap-1.5 text-sm font-semibold text-secondary-500 bg-inset border border-secondary-300 hover:border-secondary-400 rounded-lg px-3.5 py-2 transition-colors"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden />
        {machineName ?? "Kiosk"}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 bg-surface border border-secondary-200 rounded-xl shadow-lg p-4 w-64 space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-secondary-400">
              Machine
            </p>
            <p className="text-2xl font-display text-secondary-900 mt-1">
              {machineName ?? "Kiosk"}
            </p>
            <p className="text-xs text-secondary-400 mt-1">This device is in kiosk mode</p>
          </div>
          <Button
            variant="danger"
            className="w-full"
            onClick={() => {
              setOpen(false);
              setExiting(true);
            }}
          >
            Exit kiosk mode
          </Button>
        </div>
      )}
      {exiting && <ExitKioskDialog onClose={() => setExiting(false)} />}
    </div>
  );
}
