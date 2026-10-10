import { allAppsUrl as ALL_APPS_URL } from "@g3/site-config";
import { useEffect, useState } from "react";
import { API, redirectToLogin } from "../utils/auth";
import type { PageType } from "../utils/token";
import "./ConfirmPage.css";

interface Props {
  action: PageType;
  w: string;
}

type Status =
  | { kind: "loading" }
  | { kind: "ready"; displayName: string }
  | { kind: "submitting"; displayName: string }
  | {
      kind: "success";
      displayName: string;
      action: PageType;
      durationMs?: number;
      totalHours?: number;
    }
  | { kind: "error"; message: string };

const REDIRECT_SECONDS = 5;

function tokenValid(w: string): boolean {
  const win = Number(w);
  // The worker uses the same clock that issued the kiosk code and is the sole
  // expiry authority. A local time check falsely rejected codes on phones whose
  // clocks differed from the server.
  return Number.isSafeInteger(win) && win >= 0;
}

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor((ms % 60_000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function ConfirmPage({ action, w }: Props) {
  const isSignIn = action === "signin";
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [redirectIn, setRedirectIn] = useState(REDIRECT_SECONDS);

  // After a successful sign in/out, count down and return to the apps hub.
  useEffect(() => {
    if (status.kind !== "success") return;
    setRedirectIn(REDIRECT_SECONDS);
    const interval = setInterval(() => {
      setRedirectIn((n) => {
        if (n <= 1) {
          clearInterval(interval);
          window.location.href = ALL_APPS_URL;
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status.kind]);

  // Identify the member from their G3ID session (no name picker). If there's no
  // valid session, redirect to G3ID and come back here afterward.
  useEffect(() => {
    if (!tokenValid(w)) {
      setStatus({ kind: "error", message: "QR CODE EXPIRED\nASK FOR A FRESH SCAN" });
      return;
    }
    fetch(`${API}/me`, { credentials: "include" })
      .then(async (r) => {
        if (r.status === 401) {
          redirectToLogin();
          return;
        }
        if (!r.ok) {
          setStatus({ kind: "error", message: "CONNECTION ERROR\nTRY AGAIN" });
          return;
        }
        const me = (await r.json()) as { displayName: string };
        setStatus({ kind: "ready", displayName: me.displayName });
      })
      .catch(() => setStatus({ kind: "error", message: "CONNECTION ERROR\nTRY AGAIN" }));
  }, [w]);

  async function handleConfirm(displayName: string) {
    if (!tokenValid(w)) {
      setStatus({ kind: "error", message: "QR CODE EXPIRED\nASK FOR A FRESH SCAN" });
      return;
    }
    setStatus({ kind: "submitting", displayName });
    try {
      const res = await fetch(`${API}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ w: Number.parseInt(w, 10) }),
      });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        durationMs?: number;
        totalHours?: number;
      };
      if (!res.ok || data.error) {
        const msg =
          data.error === "ALREADY_SIGNED_IN"
            ? "ALREADY SIGNED IN"
            : data.error === "NOT_SIGNED_IN"
              ? "NOT SIGNED IN\nSIGN IN FIRST"
              : data.error === "TOKEN_EXPIRED"
                ? "QR CODE EXPIRED\nASK FOR A FRESH SCAN"
                : (data.error ?? "SOMETHING WENT WRONG");
        setStatus({ kind: "error", message: msg });
      } else {
        setStatus({
          kind: "success",
          displayName,
          action,
          durationMs: data.durationMs,
          totalHours: data.totalHours,
        });
      }
    } catch {
      setStatus({ kind: "error", message: "CONNECTION ERROR\nTRY AGAIN" });
    }
  }

  const variant = isSignIn ? "signin" : "signout";

  return (
    <div className={`select select--${variant}`}>
      <div className="select__inner">
        {status.kind === "loading" && (
          <div className="select__state">
            <div className="select__spinner" />
            <p className="select__state-text">IDENTIFYING…</p>
          </div>
        )}

        {status.kind === "ready" && (
          <div className="confirm">
            <h1 className="select__title">{isSignIn ? "SIGN IN" : "SIGN OUT"}</h1>
            <div className="confirm__who">
              <span className="confirm__label">
                {isSignIn ? "Signing in as" : "Signing out as"}
              </span>
              <span className="confirm__name">{status.displayName}</span>
            </div>
            <button
              type="button"
              className="confirm__btn"
              onClick={() => handleConfirm(status.displayName)}
            >
              Confirm
            </button>
          </div>
        )}

        {status.kind === "submitting" && (
          <div className="select__state">
            <div className="select__spinner" />
            <p className="select__state-text">{status.displayName}</p>
          </div>
        )}

        {status.kind === "success" && (
          <div className="select__state select__state--success">
            <div className="select__check">✓</div>
            <p className="select__state-name">{status.displayName}</p>
            <p className="select__state-action">
              {status.action === "signin" ? "SIGNED IN" : "SIGNED OUT"}
            </p>
            {status.durationMs != null && (
              <p className="select__state-duration">
                SESSION — {formatDuration(status.durationMs)}
              </p>
            )}
            {status.action === "signout" && status.totalHours != null && (
              <p className="select__state-duration">
                TOTAL HOURS THIS SCHOOL YEAR — {status.totalHours.toFixed(2)}h
              </p>
            )}
            <p className="confirm__redirect">Returning to apps in {redirectIn}s…</p>
          </div>
        )}

        {status.kind === "error" && (
          <div className="select__state select__state--error">
            <div className="select__exclaim">!</div>
            {status.message.split("\n").map((line, i) => (
              <p key={line} className={i === 0 ? "select__state-name" : "select__state-action"}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
