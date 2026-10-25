import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";

export type AuthUser = {
  userId: string;
  isAdmin: boolean;
  email: string;
  displayName: string;
  sessionType: "oauth" | "pin";
  kioskDeviceId: number | null;
  kioskDeviceName: string | null;
  /** A shop manager: they may check off Quality Control steps, as admins may. */
  isShopManager: boolean;
  /** The team's quality check: whether every part ends with one, and which process it is. */
  qualityCheck: { required: boolean; processId: number | null };
  /** Quality Control steps are finished with a quality report, not Start Part / Mark Complete. */
  qualityReports: boolean;
  /** The team's quality checklist, in order; empty while quality reports are off. */
  qualityChecklist: string[];
  /** The Overview's shop status words, lowest first: each while the queue is under `below`. */
  statusLevels: StatusLevel[];
};

export type StatusLevel = { label: string; below: number | null };

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthenticated" };

export function useAuth(): AuthState & { refresh: () => void } {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const refreshRef = useRef<() => void>(() => {});

  // Read again on focus and every minute: an admin can turn quality reports or a quality check on
  // while this page is open, and the worker enforces it at once, so a page holding the old answer
  // would offer Mark Complete for a step the worker then refuses.
  useEffect(() => {
    let canceled = false;
    let first = true;

    async function load() {
      const res = await api.me.$get();
      if (canceled) return;
      if (res.ok) {
        setState({ status: "authenticated", user: (await res.json()) as AuthUser });
      } else if (first) {
        // Only the first read decides someone isn't signed in; later failures keep what we have,
        // so a blip doesn't throw someone out mid-part.
        setState({ status: "unauthenticated" });
      }
      first = false;
    }

    const reload = () => {
      void load().catch(() => {});
    };
    refreshRef.current = reload;
    reload();
    const timer = setInterval(reload, 60 * 1000);
    window.addEventListener("focus", reload);
    return () => {
      canceled = true;
      clearInterval(timer);
      window.removeEventListener("focus", reload);
    };
  }, []);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { ...state, refresh };
}

/** The authenticated user, provided by ProtectedRoute for the whole app. */
export const AuthUserContext = createContext<AuthUser | null>(null);

export function useAuthUser(): AuthUser | null {
  return useContext(AuthUserContext);
}

/** Reads `/me` again, for a page that has just changed something it answers. */
export const AuthRefreshContext = createContext<() => void>(() => {});

export function useRefreshAuthUser(): () => void {
  return useContext(AuthRefreshContext);
}

/** Whether this person may mark a Quality Control step complete. */
export function useCanQualityCheck(): boolean {
  const user = useAuthUser();
  return !!user && (user.isAdmin || user.isShopManager);
}

/** True when the app should present the kiosk experience: either the session
 * is a PIN session or this device has been marked as a kiosk. */
export function useKiosk(): { active: boolean; machineName: string | null } {
  const user = useAuthUser();
  const active = user?.sessionType === "pin";
  return { active, machineName: user?.kioskDeviceName ?? null };
}
