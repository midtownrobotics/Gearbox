import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { matchMachineProcess } from "./derive";
import { fetchProcessQueue, fetchProcesses } from "./getters";
import { kioskLogout } from "./kiosk";
import { useAuthUser } from "./use-auth";

/** Warn this long before the auto-logout fires. */
const WARNING_MS = 30 * 1000;
/** Machine kiosks (name matches a process) log out after 8 minutes idle… */
const MACHINE_TIMEOUT_MS = 8 * 60 * 1000;
/** …other kiosks after 5. */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
/** How often to refresh presence and the machine's in-progress state. */
const HEARTBEAT_MS = 60 * 1000;

/**
 * Wraps the app when a kiosk (PIN) session is active. Handles:
 * - presence heartbeats so the shop floor can show who is at each machine
 * - the inactivity auto-logout with a 30-second "still there?" warning;
 *   suspended while the kiosk's machine has a part marked in progress
 */
export function KioskShell({ children }: { children: ReactNode }) {
  const user = useAuthUser();
  const isKioskSession = user?.sessionType === "pin";
  const machineName = user?.kioskDeviceName ?? null;

  const lastActivityRef = useRef(Date.now());
  const machineBusyRef = useRef(false);
  const machineProcessIdRef = useRef<number | null>(null);
  const loggingOutRef = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const stay = useCallback(() => {
    lastActivityRef.current = Date.now();
    setSecondsLeft(null);
  }, []);

  // Track user activity.
  useEffect(() => {
    if (!isKioskSession) return;
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;
    for (const ev of events) window.addEventListener(ev, bump, { passive: true });
    return () => {
      for (const ev of events) window.removeEventListener(ev, bump);
    };
  }, [isKioskSession]);

  // Resolve the machine process, send presence heartbeats, and poll whether
  // the machine has a part in progress (which suspends the auto-logout).
  useEffect(() => {
    if (!isKioskSession) return;
    let canceled = false;

    async function beat() {
      api["kiosk-presence"].heartbeat.$post().catch(() => {});
      try {
        if (machineProcessIdRef.current === null && machineName) {
          const processes = await fetchProcesses();
          if (canceled) return;
          machineProcessIdRef.current = matchMachineProcess(processes, machineName)?.id ?? null;
        }
        if (machineProcessIdRef.current !== null) {
          const queue = await fetchProcessQueue(machineProcessIdRef.current);
          if (canceled) return;
          machineBusyRef.current = queue.some((p) => p.status === "doing");
        }
      } catch {
        // Keep the previous busy state if a poll fails.
      }
    }

    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => {
      canceled = true;
      clearInterval(id);
    };
  }, [isKioskSession, machineName]);

  // The countdown itself.
  useEffect(() => {
    if (!isKioskSession) return;
    const id = setInterval(() => {
      // A part in progress at this machine means someone is working here.
      if (machineProcessIdRef.current !== null && machineBusyRef.current) {
        lastActivityRef.current = Date.now();
        setSecondsLeft(null);
        return;
      }
      const timeout =
        machineProcessIdRef.current !== null ? MACHINE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
      const remaining = timeout - (Date.now() - lastActivityRef.current);
      if (remaining <= 0) {
        if (!loggingOutRef.current) {
          loggingOutRef.current = true;
          kioskLogout();
        }
        return;
      }
      setSecondsLeft(remaining <= WARNING_MS ? Math.ceil(remaining / 1000) : null);
    }, 1000);
    return () => clearInterval(id);
  }, [isKioskSession]);

  return (
    <>
      {children}
      {isKioskSession && secondsLeft !== null && (
        <div className="fixed inset-0 z-[100] bg-ink/70 flex items-center justify-center p-6">
          <div className="bg-paper rounded-2xl shadow-xl max-w-md w-full p-8 text-center space-y-5">
            <h2 className="font-display text-4xl text-ink">Still there?</h2>
            <p className="text-steel-dark">
              You'll be logged out in <span className="font-bold text-crimson">{secondsLeft}</span>{" "}
              second{secondsLeft === 1 ? "" : "s"} due to inactivity.
            </p>
            <button
              type="button"
              onClick={stay}
              className="w-full py-4 rounded-xl bg-crimson hover:bg-crimson-dark text-paper text-lg font-semibold transition-colors"
            >
              I'm still here
            </button>
          </div>
        </div>
      )}
    </>
  );
}
