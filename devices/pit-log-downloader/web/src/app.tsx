import { AppNavBar, ErrorBanner, Loading, Page, buttonClass } from "@g3/ui";
import { useEffect, useState } from "react";
import type { Status } from "../../src/status.ts";
import { GearboxCard } from "./gearbox-card";
import { ActivityCard, ConnectionTiles, Counts, LogsCard, RobotCard, SettingsCard } from "./parts";

const POLL_INTERVAL_MS = 3000;

/** The downloader's status, asked for every few seconds while the page is showing. */
function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [lost, setLost] = useState(false);
  // Bumped to ask again at once, after a change.
  const [asked, setAsked] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `asked` starts it again, asking at once
  useEffect(() => {
    let current = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) throw new Error(res.statusText);
        const next = (await res.json()) as Status;
        if (current) {
          setStatus(next);
          setLost(false);
        }
      } catch {
        if (current) setLost(true);
      }
    };
    void load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      current = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", load);
    };
  }, [asked]);

  return { status, lost, refresh: () => setAsked((n) => n + 1) };
}

export function App() {
  const { status, lost, refresh } = useStatus();
  const driveFolderUrl = status?.settings.driveFolderUrl;

  return (
    <div className="flex flex-1 flex-col bg-page">
      {/* A tool on this computer, not a team's app: built-in colors, no sign-in, no app list. */}
      <AppNavBar
        title={status ? `${status.settings.teamNumber} PIT LOGS` : "PIT LOGS"}
        icon="/favicon.svg"
        items={[]}
        team={false}
        allApps={false}
        account={false}
        version={status ? `Pit log downloader ${status.version}` : undefined}
      />
      <Page
        title="Match logs"
        description="Logs are copied off the robot whenever this computer joins its network."
        width="wide"
        actions={
          driveFolderUrl && (
            <a
              className={buttonClass("secondary")}
              href={driveFolderUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open Drive folder
            </a>
          )
        }
      >
        {lost && (
          <ErrorBanner message="Can't reach the downloader. Check that it's still running on this computer." />
        )}
        {status ? (
          <>
            <ConnectionTiles status={status} />
            <Counts status={status} />
            <GearboxCard
              gearbox={status.gearbox}
              teamNumber={status.settings.teamNumber}
              onChange={refresh}
            />
            <LogsCard status={status} />
            <div className="grid gap-5 lg:grid-cols-2">
              <RobotCard status={status} />
              <ActivityCard status={status} />
            </div>
            <SettingsCard status={status} />
          </>
        ) : (
          !lost && <Loading />
        )}
      </Page>
    </div>
  );
}
