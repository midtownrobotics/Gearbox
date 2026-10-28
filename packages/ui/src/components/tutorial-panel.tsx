import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type TutorialAppsMessage,
  type TutorialDocMessage,
  type TutorialRole,
  isTutorialDocMessage,
  setTutorial,
  takeHandedOffDoc,
  useFeaturesOff,
} from "../tutorial";

// Tutorial mode's panel: the docs page about the page you're on (`src`, the bar's "Need help?"
// address), in the right third of the window, in the docs' compact view (`?embed`). The two follow
// each other: a page about another doc loads that one here, and a page the reader opens here
// tells the app (`onDocPage`, from the docs page's postMessage), which goes to the page it's about.
// Moving between pages of the doc it already shows leaves it as it is. It tells the docs page
// which apps the team has on (`apps`) and the reader's `role`, so its previous and next links
// skip the pages the reader can't open. While
// it's open, <html> has `data-tutorial` (see ../tutorial.ts).

/** How long after the reader opens a page in the panel the app's moves count as following it. */
const FOLLOWING_MS = 2000;

export function TutorialPanel({
  src,
  apps,
  role,
  onDocPage,
}: {
  src: string;
  /** The apps the team has on, null when that isn't known. */
  apps: string[] | null;
  /** The reader's role, null while it isn't known. */
  role: TutorialRole | null;
  onDocPage: (doc: TutorialDocMessage) => void;
}) {
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-tutorial", "");
    return () => {
      html.removeAttribute("data-tutorial");
    };
  }, []);

  const docsOrigin = new URL(src).origin;
  const frame = useRef<HTMLIFrameElement>(null);
  // The doc the reader chose in the app before, when following it brought them here; else the
  // doc about this page.
  const [handedOff] = useState(takeHandedOffDoc);
  const [frameSrc, setFrameSrc] = useState(() => (handedOff ? `${docsOrigin}${handedOff}` : src));
  const frameSrcRef = useRef(frameSrc);
  frameSrcRef.current = frameSrc;
  // The docs page the frame shows now (its path), as it last said.
  const [showing, setShowing] = useState<string | null>(null);
  const showingRef = useRef<string | null>(null);
  const follow = useRef(onDocPage);
  follow.current = onDocPage;

  // When the reader last opened a page here: the app then follows, maybe on to a page about
  // another doc (an app's home redirects to its first page), and the panel keeps what they chose.
  const ledAt = useRef(handedOff ? Date.now() : 0);

  // The app is on a page about another doc: load it, unless the frame shows it already, or the
  // app only moved to follow the reader.
  useEffect(() => {
    if (Date.now() - ledAt.current < FOLLOWING_MS) return;
    if (new URL(src).pathname !== showingRef.current) setFrameSrc(src);
  }, [src]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== docsOrigin) return;
      if (!isTutorialDocMessage(e.data)) return;
      // The reader opened it here, rather than the panel loading what the app asked for.
      const moved =
        e.data.pathname !== showingRef.current &&
        e.data.pathname !== new URL(frameSrcRef.current).pathname;
      showingRef.current = e.data.pathname;
      setShowing(e.data.pathname);
      if (moved) ledAt.current = Date.now();
      follow.current(e.data);
      // The docs page is ready once it says where it is: it may have missed the apps on load.
      sendAppsRef.current();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [docsOrigin]);

  // The team's apps and the reader's role, to the docs page: each time it loads, and when they
  // change.
  const appsKey = apps ? apps.join(",") : null;
  const featuresOff = useFeaturesOff(apps);
  const sendApps = () => {
    const message: TutorialAppsMessage = {
      type: "gearbox-tutorial-apps",
      apps: appsKey === null ? null : appsKey.split(","),
      role,
      featuresOff,
    };
    frame.current?.contentWindow?.postMessage(message, docsOrigin);
  };
  const sendAppsRef = useRef(sendApps);
  sendAppsRef.current = sendApps;
  // biome-ignore lint/correctness/useExhaustiveDependencies: sent again only when these change
  useEffect(sendApps, [appsKey, role, featuresOff?.join(",")]);

  const embedded = `${frameSrc}${frameSrc.includes("?") ? "&" : "?"}embed`;
  // "Loading…" over the frame until the docs page it was given has loaded.
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    <div className="g3-tutorial" role="complementary" aria-label="Tutorial">
      <div className="g3-tutorial-head">
        <span className="g3-tutorial-title">Tutorial</span>
        <a
          className="g3-tutorial-link"
          href={showing ? `${docsOrigin}${showing}` : frameSrc}
          target="_blank"
          rel="noreferrer"
        >
          Open in a new tab
        </a>
        <button
          type="button"
          className="g3-tutorial-close"
          aria-label="Close tutorial"
          title="Close tutorial"
          onClick={() => setTutorial(false)}
        >
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="g3-tutorial-body">
        <iframe
          ref={frame}
          className="g3-tutorial-frame"
          src={embedded}
          title="Docs for this page"
          onLoad={() => {
            setLoaded(embedded);
            sendApps();
          }}
        />
        {loaded !== embedded && <p className="g3-tutorial-loading">Loading…</p>}
      </div>
    </div>
  );
}
