import { useEffect, useState } from "react";
import "./index.css";
import ConfirmPage from "./pages/ConfirmPage";
import KioskPage from "./pages/KioskPage";
import { API, type Me, redirectToLogin } from "./utils/auth";
import type { PageType } from "./utils/token";

// The kiosk display (QR + live code) is admin-only. Members never need it — they
// just scan it. Non-admins are redirected to G3ID; logged-in non-admins are denied.
function KioskGate({ types }: { types: PageType[] }) {
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");

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
      <div className="scanlines" aria-hidden="true" />
      <div className="kiosk__content kiosk-gate">
        {state === "loading" ? (
          <p className="kiosk-gate__text">AUTHORIZING…</p>
        ) : (
          <>
            <p className="kiosk-gate__title">ADMIN ACCESS REQUIRED</p>
            <p className="kiosk-gate__text">
              Sign in with an admin G3ID account to run this kiosk.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// The kiosk displays, by path: /signin and /signout show one QR code, /kiosk both side by side.
const KIOSKS: Record<string, PageType[]> = {
  "/signin": ["signin"],
  "/signout": ["signout"],
  "/kiosk": ["signin", "signout"],
};

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get("action") as PageType | null;
  const w = params.get("w");

  // Member scanned the kiosk QR → confirm sign-in/out as their G3ID identity.
  if (action && w) {
    return <ConfirmPage action={action} w={w} />;
  }

  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const types = KIOSKS[path];
  if (types) return <KioskGate key={path} types={types} />;

  // Anything else (the bare address included) opens the combined kiosk.
  window.history.replaceState(null, "", "/kiosk");
  return <KioskGate key="/kiosk" types={KIOSKS["/kiosk"]} />;
}
