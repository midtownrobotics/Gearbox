import { Button, ErrorBanner, inputClass } from "@g3/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useFullscreen } from "../../shared/fullscreen-context";
import { scopeLogFile, scopeUrl } from "../../shared/getters/advantagescope";
import { type MatchLog, fetchMatchLogs } from "../../shared/getters/downloaders";

// AdvantageScope inside Pit: the team's match logs to choose from, and AdvantageScope Lite (served
// at /scope/) in a frame below, as its makers ship it. The chosen log is in the address. Full
// screen hides Pit's bar for a small one of its own; the header is written out (Page's look) so
// both modes keep the same frame.

/** The frame's height: from where it starts to the bottom of the window (again after full screen). */
function useFillHeight(isFullscreen: boolean) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(600);
  useLayoutEffect(() => {
    // Full screen, the frame fills what's under the small bar by itself.
    if (isFullscreen) return;
    const update = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(420, window.innerHeight - top - 16));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [isFullscreen]);
  return { ref, height };
}

function byEvent(logs: MatchLog[]) {
  const events = new Map<string, MatchLog[]>();
  for (const log of logs) events.set(log.event, [...(events.get(log.event) ?? []), log]);
  for (const list of events.values()) list.sort((a, b) => b.matchNumber - a.matchNumber);
  return [...events];
}

export function AdvantageScopePage() {
  const [params, setParams] = useSearchParams();
  const file = params.get("log") ?? "";
  const [logs, setLogs] = useState<MatchLog[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { isFullscreen, setFullscreen } = useFullscreen();
  const { ref, height } = useFillHeight(isFullscreen);

  useEffect(() => {
    fetchMatchLogs()
      .then((data) => setLogs(data.logs))
      .catch(() => setFailed(true));
  }, []);

  // Leaving the browser's full screen (Esc) or the page ends it here too.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      setFullscreen(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [setFullscreen]);

  const toggleFullscreen = async () => {
    if (isFullscreen) {
      setFullscreen(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    } else {
      setFullscreen(true);
      // Where the browser won't (an iPad), the page still fills the window.
      await document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  // The same elements in both modes, so going full screen doesn't load AdvantageScope again.
  return (
    <main className={isFullscreen ? "fixed inset-0 z-50 flex flex-col bg-page" : "flex-1 bg-page"}>
      <div
        className={
          isFullscreen
            ? "flex items-center gap-2 border-b border-line bg-surface px-3 py-1.5"
            : "flex flex-wrap items-end justify-between gap-4 px-4 pt-6 pb-5 sm:px-6"
        }
      >
        {isFullscreen ? (
          <span className="text-sm font-semibold text-secondary-900">AdvantageScope</span>
        ) : (
          <h1 className="text-4xl text-secondary-900">AdvantageScope</h1>
        )}
        <div className={`flex flex-wrap items-center gap-2 ${isFullscreen ? "ml-auto" : ""}`}>
          <select
            aria-label="Match log"
            className={`${inputClass} min-w-0 max-w-full sm:w-64 ${isFullscreen ? "py-1 text-sm" : ""}`}
            value={file}
            onChange={(e) =>
              setParams(e.target.value ? { log: e.target.value } : {}, { replace: true })
            }
          >
            <option value="">
              {logs?.length === 0 ? "No match logs yet" : "Choose a match log"}
            </option>
            {byEvent(logs ?? []).map(([event, list]) => (
              <optgroup key={event} label={event}>
                {list.map((log) => (
                  <option key={log.id} value={scopeLogFile(log)}>
                    {log.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={() => void toggleFullscreen()}>
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </Button>
        </div>
      </div>
      {failed && (
        <div className={isFullscreen ? "px-3 pt-2" : "px-4 pb-5 sm:px-6"}>
          <ErrorBanner message="Couldn't load the match logs. Check your connection and try again." />
        </div>
      )}
      <div className={isFullscreen ? "min-h-0 flex-1" : "px-4 pb-4 sm:px-6"}>
        <iframe
          // A new log loads AdvantageScope again, opening it.
          key={file}
          ref={ref}
          title="AdvantageScope"
          src={scopeUrl(file || undefined)}
          allowFullScreen
          className={`block w-full ${isFullscreen ? "h-full" : "rounded-lg border border-line"}`}
          style={isFullscreen ? undefined : { height }}
        />
      </div>
    </main>
  );
}
