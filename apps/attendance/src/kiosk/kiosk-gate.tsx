import { forceTheme } from "@g3/ui";
import { useEffect, useState } from "react";
import { API, type Me, redirectToLogin } from "../shared/api";
import type { PageType } from "../shared/token";
import KioskPage from "./KioskPage";

// The kiosk display (QR + live code) is admin-only. Members never need it — they
// just scan it. Non-admins are redirected to G3ID; logged-in non-admins are denied.
export function KioskGate({ types }: { types: PageType[] }) {
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");

  // The kiosk display is always dark (it's usually a shop TV), whatever the shared setting says.
  useEffect(() => {
    forceTheme("dark");
    return () => forceTheme(null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/me`, { credentials: "include" });
        if (r.status === 401) {
          redirectToLogin();
          return;
        }
        if (!r.ok) {
          setState("denied");
          return;
        }
        const me = (await r.json()) as Me;
        setState(me.isAdmin ? "ok" : "denied");
      } catch {
        setState("denied");
      }
    })();
  }, []);

  if (state === "ok") {
    return <KioskPage types={types} />;
  }

  return (
    <div className={`kiosk ${types.length > 1 ? "kiosk--combined" : `kiosk--${types[0]}`}`}>
      <div className="kiosk__content kiosk-gate">
        {state === "loading" ? (
          <p className="kiosk-gate__text">AUTHORIZING…</p>
        ) : (
          <>
            <p className="kiosk-gate__title">ADMIN ACCESS REQUIRED</p>
            <p className="kiosk-gate__text">Sign in with an admin account to run this kiosk.</p>
          </>
        )}
      </div>
    </div>
  );
}

// The kiosk displays, by path: /signin and /signout show one QR code, /kiosk both side by side.
export const KIOSKS: Record<string, PageType[]> = {
  "/signin": ["signin"],
  "/signout": ["signout"],
  "/kiosk": ["signin", "signout"],
};
