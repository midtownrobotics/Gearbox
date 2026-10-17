import { ErrorBanner, Page, inputClass } from "@g3/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { scopeLogFile, scopeUrl } from "../../shared/getters/advantagescope";
import { type MatchLog, fetchMatchLogs } from "../../shared/getters/downloaders";

// AdvantageScope inside Pit: the team's match logs to choose from, and AdvantageScope Lite (served
// at /scope/) in a frame below, as its makers ship it. The chosen log is in the address.

/** The frame's height: from where it starts to the bottom of the window. */
function useFillHeight() {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(600);
  useLayoutEffect(() => {
    const update = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(420, window.innerHeight - top - 16));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
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
  const { ref, height } = useFillHeight();

  useEffect(() => {
    fetchMatchLogs()
      .then((data) => setLogs(data.logs))
      .catch(() => setFailed(true));
  }, []);

  return (
    <Page
      title="AdvantageScope"
      width="full"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Match log"
            className={`${inputClass} min-w-0 max-w-full sm:w-64`}
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
        </div>
      }
    >
      {failed && (
        <ErrorBanner message="Couldn't load the match logs. Check your connection and try again." />
      )}
      <iframe
        // A new log loads AdvantageScope again, opening it.
        key={file}
        ref={ref}
        title="AdvantageScope"
        src={scopeUrl(file || undefined)}
        allowFullScreen
        className="block w-full rounded-lg border border-line"
        style={{ height }}
      />
    </Page>
  );
}
