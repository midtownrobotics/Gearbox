import {
  AppNavBar,
  Button,
  ErrorBanner,
  Loading,
  Page,
  buttonClass,
  refreshTeamUiSettings,
  useTeamIcon,
  useTeamUiSettings,
} from "@g3/ui";
import { useEffect, useState } from "react";
import type { Status } from "../../src/status.ts";
import { GearboxCard, PairingCard } from "./gearbox-card";
import { ActivityCard, ConnectionTiles, Counts, LogsCard, RobotCard, SettingsCard } from "./parts";

const POLL_INTERVAL_MS = 3000;

/** The downloader's status, asked for every few seconds while the page is showing. */
function useStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [lost, setLost] = useState(false);

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
  }, []);

  return { status, lost };
}

/** The downloader has stopped answering: how to start it again, as it last said. */
function Stopped({ restartCommand }: { restartCommand?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <ErrorBanner
        message={
          restartCommand
            ? "The downloader has stopped. To start it again, open a terminal on this computer (PowerShell on Windows), run the command below and leave it running. This page picks it up once it's back."
            : "The downloader has stopped. Start it again from a terminal on this computer, and this page picks it up once it's back."
        }
      />
      {restartCommand && (
        <div className="flex items-start gap-2 rounded-lg bg-inset px-3 py-2">
          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs leading-5 text-secondary-900">
            {restartCommand}
          </pre>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(restartCommand).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function App() {
  const { status, lost } = useStatus();
  // The team's logs in Pit, once paired.
  const pitLogsUrl = status?.gearbox.paired ? `${status.gearbox.paired.pitUrl}/logs` : null;
  // Until it's paired, pairing is all there is.
  const unpaired = status !== null && !status.gearbox.paired;
  const teamNumber = status?.gearbox.paired?.teamNumber;

  // Once paired, the page takes its team's appearance from Gearbox (Team Appearance): colors,
  // names, logo. Until it has loaded, the bar shows the team's number, never another team's name.
  const teamUi = useTeamUiSettings(Boolean(teamNumber));
  const [appearanceLoaded, setAppearanceLoaded] = useState(false);
  useEffect(() => {
    if (teamNumber) void refreshTeamUiSettings().then(() => setAppearanceLoaded(true));
  }, [teamNumber]);
  const styled = Boolean(teamNumber) && appearanceLoaded;
  const appIcon = useTeamIcon(styled ? "/favicon.svg" : undefined) ?? "/favicon.svg";
  // A logo is on the internet: offline, the app's icon in the team's color.
  const icon = styled && teamUi.logoUrl && status?.connection.internet ? teamUi.logoUrl : appIcon;
  const shortName = styled ? teamUi.shortName : teamNumber;

  return (
    <div className="flex flex-1 flex-col bg-page">
      {/* A tool on this computer: no sign-in and no app list, and its team's look once paired. */}
      <AppNavBar
        title={shortName ? `${shortName} PIT LOGS`.toUpperCase() : "PIT LOGS"}
        icon={icon}
        items={[]}
        team={false}
        allApps={false}
        account={false}
        version={status ? `Pit log downloader ${status.version}` : undefined}
      />
      <Page
        title={unpaired ? "Pair with Gearbox" : "Match logs"}
        description={
          unpaired
            ? "Pair this computer with your team's Pit to start copying the robot's match logs."
            : "Logs are copied off the robot whenever this computer joins its network."
        }
        width={unpaired ? "narrow" : "wide"}
        actions={
          pitLogsUrl && (
            <a
              className={buttonClass("secondary")}
              href={pitLogsUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in Pit
            </a>
          )
        }
      >
        {lost && <Stopped restartCommand={status?.restartCommand} />}
        {status && unpaired ? (
          // Pairing (and unpairing) reloads the page, which then takes the team's appearance or
          // drops it.
          <PairingCard gearbox={status.gearbox} onPaired={() => window.location.reload()} />
        ) : status ? (
          <>
            <ConnectionTiles status={status} />
            <Counts status={status} />
            <GearboxCard gearbox={status.gearbox} onChange={() => window.location.reload()} />
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
