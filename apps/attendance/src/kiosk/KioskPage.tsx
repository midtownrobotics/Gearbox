import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { API, redirectToLogin } from "../shared/api";
import { type PageType, msUntilNextWindow } from "../shared/token";
import "./KioskPage.css";

// Dark green and dark red modules on the white tile: the shared palette's 700s, which every
// phone camera reads easily.
const QR_SIGN_IN = "#15803d";
const QR_SIGN_OUT = "#b91c1c";

interface Props {
  types: PageType[];
}

/** Why the display couldn't get a fresh code: each needs something different done about it. */
type Problem = "offline" | "server" | "signed-out" | "not-admin";

type CodeResult = { kind: "ok"; w: number } | { kind: Problem };

/** How soon to try again after a failed fetch, rather than waiting for the next window. */
const RETRY_MS = 5_000;
/**
 * How long a code is shown without a fresh one. The worker takes a scan up to about two minutes
 * after its code was shown, so this leaves room for a phone that's slow to open the link.
 */
const STALE_MS = 90_000;

const PROBLEMS: Record<Problem, { title: string; text: string }> = {
  offline: {
    title: "NO CONNECTION",
    text: "CHECK THIS COMPUTER'S INTERNET. THE CODE COMES BACK BY ITSELF.",
  },
  server: { title: "CAN'T GET A NEW CODE", text: "TRYING AGAIN…" },
  "signed-out": { title: "SIGNED OUT", text: "SIGN IN AGAIN ON THIS COMPUTER." },
  "not-admin": { title: "ADMIN ACCESS REQUIRED", text: "SIGN IN WITH AN ADMIN ACCOUNT." },
};

async function fetchCode(): Promise<CodeResult> {
  try {
    const response = await fetch(`${API}/code`, { credentials: "include" });
    if (response.status === 401) return { kind: "signed-out" };
    if (response.status === 403) return { kind: "not-admin" };
    if (!response.ok) return { kind: "server" };
    const data = (await response.json()) as { w?: number };
    return typeof data.w === "number" ? { kind: "ok", w: data.w } : { kind: "server" };
  } catch {
    return { kind: navigator.onLine ? "server" : "offline" };
  }
}

export default function KioskPage({ types }: Props) {
  const isCombined = types.length > 1;
  const [code, setCode] = useState<{ w: number; at: number } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [now, setNow] = useState(Date.now());

  // Fetch the code at each new window, sooner after a failure, and at once when the network
  // comes back.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let stopped = false;
    const run = async () => {
      if (running) return;
      running = true;
      clearTimeout(timer);
      const result = await fetchCode();
      running = false;
      if (stopped) return;
      if (result.kind === "ok") {
        setCode({ w: result.w, at: Date.now() });
        setProblem(null);
      } else {
        setProblem(result.kind);
      }
      timer = setTimeout(run, result.kind === "ok" ? msUntilNextWindow() : RETRY_MS);
    };
    const offline = () => setProblem("offline");
    run();
    window.addEventListener("online", run);
    window.addEventListener("offline", offline);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", run);
      window.removeEventListener("offline", offline);
    };
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, []);

  const secondsLeft = Math.ceil(msUntilNextWindow() / 1000);
  const shown = problem ? PROBLEMS[problem] : null;
  // The last code stays up only while a scan of it would still work: it isn't too old yet, and
  // the trouble is only this display's (its connection or its sign-in). After a server error a
  // scan may fail too, so the codes go and the error takes their place.
  const fresh = code && now - code.at < STALE_MS ? code : null;
  const live = fresh && problem !== "server" ? fresh : null;
  const errorOnly = shown && !live;

  return (
    <div className={`kiosk ${isCombined ? "kiosk--combined" : `kiosk--${types[0]}`}`}>
      <div className={`kiosk__content${errorOnly ? " kiosk__content--problem" : ""}`}>
        {!errorOnly && (
          <div className={`kiosk__codes ${isCombined ? "kiosk__codes--combined" : ""}`}>
            {types.map((type) => {
              const isSignIn = type === "signin";
              return (
                <section className={`kiosk__code kiosk__code--${type}`} key={type}>
                  <h2 className="kiosk__label">{isSignIn ? "SIGN IN" : "SIGN OUT"}</h2>
                  <div className="kiosk__qr-wrapper">
                    <div className="kiosk__qr-frame" key={`${type}-${live?.w ?? "none"}`}>
                      {live ? (
                        <QRCodeSVG
                          className="kiosk__qr-code"
                          value={`${window.location.origin}/?action=${type}&w=${live.w}`}
                          size={460}
                          bgColor="#ffffff"
                          fgColor={isSignIn ? QR_SIGN_IN : QR_SIGN_OUT}
                          level="M"
                        />
                      ) : (
                        <div className="kiosk__qr-loading">…</div>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {shown ? (
          <div className="kiosk__problem" role="alert">
            <span className="kiosk__problem-title">{shown.title}</span>
            <span className="kiosk__problem-text">
              {live ? "THIS CODE STILL WORKS FOR NOW. " : ""}
              {shown.text}
            </span>
            {(problem === "signed-out" || problem === "not-admin") && (
              <button type="button" className="kiosk__problem-button" onClick={redirectToLogin}>
                SIGN IN
              </button>
            )}
          </div>
        ) : (
          <div className="kiosk__timer">
            <span className="kiosk__timer-label">NEW CODE IN</span>
            <span className="kiosk__timer-seconds">{secondsLeft}s</span>
          </div>
        )}
      </div>
    </div>
  );
}
