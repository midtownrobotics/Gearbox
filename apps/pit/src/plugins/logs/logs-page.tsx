import {
  Button,
  Card,
  ConfirmButton,
  ErrorBanner,
  Loading,
  Page,
  SuccessBanner,
  buttonClass,
  useTeamNames,
} from "@g3/ui";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { advantageScopePage } from "../../shared/getters/advantagescope";
import {
  type LogDownloader,
  createPairingCode,
  fetchDownloaders,
  removeDownloader,
} from "../../shared/getters/downloaders";
import { MatchLogs } from "./match-logs";
import { ScopeAssets } from "./scope-assets";
import { SetupSteps } from "./setup-steps";

// Logs: the robot's match logs, which the team's paired log downloaders (devices/pit-log-
// downloader) upload. A team with none is shown how to set one up and gets a code to pair it
// with; with one, the page lists the logs and the downloaders.

const whenFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** How often the page looks for a newly paired downloader while a code may be in use. */
const PAIRING_POLL_MS = 3000;

function ago(time: number | null) {
  if (!time) return "never";
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return whenFormat.format(time);
}

function useCountdown(until: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, until - now) : 0;
}

function PairingCode({ canManage }: { canManage: boolean }) {
  const { number } = useTeamNames();
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(code?.expiresAt ?? null);

  if (!canManage) {
    return (
      <p className="text-sm text-secondary-600">
        A mentor or admin gets the pairing code to enter in the downloader.
      </p>
    );
  }

  async function getCode() {
    setBusy(true);
    try {
      setCode(await createPairingCode());
      setError(null);
    } catch {
      setError("Couldn't get a pairing code. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const expired = code !== null && left === 0;
  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}
      {code && !expired ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className="font-mono text-4xl font-semibold tracking-[0.3em] text-secondary-900">
            {code.code}
          </p>
          <p className="text-sm text-secondary-600">
            Enter it in the downloader, with team number {number}, within{" "}
            {Math.floor(left / 60_000)}:
            {String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}. It works once.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={getCode} disabled={busy}>
            {expired ? "Get a new code" : "Get a pairing code"}
          </Button>
          {expired && <p className="text-sm text-secondary-600">That code has expired.</p>}
        </div>
      )}
    </div>
  );
}

function DownloaderRow({
  downloader,
  canManage,
  onRemoved,
}: { downloader: LogDownloader; canManage: boolean; onRemoved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-secondary-900">{downloader.name}</p>
          <p className="text-xs text-secondary-500">
            Paired by {downloader.pairedByName} on {whenFormat.format(downloader.pairedAt)} · last
            heard from {ago(downloader.lastSeenAt)}
          </p>
        </div>
        {canManage && (
          <ConfirmButton
            label="Remove"
            size="sm"
            question={`Remove ${downloader.name}? It stops reaching Pit until it's paired again.`}
            onConfirm={async () => {
              try {
                await removeDownloader(downloader.id);
                onRemoved();
              } catch {
                setError("Couldn't remove it. Check your connection and try again.");
              }
            }}
          />
        )}
      </div>
      {error && <ErrorBanner message={error} />}
    </li>
  );
}

function AddDownloader({ canManage }: { canManage: boolean }) {
  return (
    <div className="space-y-6">
      <SetupSteps />
      <div className="space-y-3 border-t border-secondary-200 pt-5">
        <p className="text-sm font-semibold text-secondary-900">Pair it with Pit</p>
        <PairingCode canManage={canManage} />
      </div>
    </div>
  );
}

export function LogsPage() {
  const [data, setData] = useState<{ downloaders: LogDownloader[]; canManage: boolean } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [paired, setPaired] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchDownloaders();
      setData((before) => {
        // A downloader that wasn't there before has just paired.
        const added = before
          ? next.downloaders.find((d) => !before.downloaders.some((b) => b.id === d.id))
          : undefined;
        if (added) {
          setPaired(added.name);
          setAdding(false);
        }
        return next;
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While someone may be pairing, look for the new downloader.
  const pairing = Boolean(data?.canManage) && (adding || data?.downloaders.length === 0);
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, PAIRING_POLL_MS);
    return () => clearInterval(timer);
  }, [pairing, load]);

  return (
    <Page
      title="Logs"
      description="The robot's match logs."
      width="narrow"
      actions={
        <Link className={buttonClass("primary", "sm")} to={advantageScopePage()}>
          Open AdvantageScope
        </Link>
      }
    >
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
        Logs is in beta and isn't fully set up yet: things may change, and logs here may not be
        kept.
      </p>
      {failed && (
        <ErrorBanner message="Couldn't load the log downloaders. Check your connection and try again." />
      )}
      {paired && <SuccessBanner message={`${paired} is paired with Pit.`} />}
      {!data ? (
        !failed && <Loading />
      ) : data.downloaders.length === 0 ? (
        <Card title="Add a log downloader">
          <p className="mb-5 text-sm text-secondary-600">
            A log downloader is a computer in the pit that copies match logs off the robot when it
            joins the robot's network. Set one up, then pair it with Pit.
          </p>
          <AddDownloader canManage={data.canManage} />
        </Card>
      ) : (
        <>
          <MatchLogs />
          <Card title="Log downloaders">
            <ul className="divide-y divide-secondary-200">
              {data.downloaders.map((d) => (
                <DownloaderRow
                  key={d.id}
                  downloader={d}
                  canManage={data.canManage}
                  onRemoved={() => void load()}
                />
              ))}
            </ul>
            {data.canManage && !adding && (
              <div className="mt-3">
                <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                  Add another
                </Button>
              </div>
            )}
          </Card>
          <ScopeAssets />
          {adding && (
            <Card title="Add a log downloader">
              <AddDownloader canManage={data.canManage} />
              <div className="mt-5">
                <Button variant="secondary" onClick={() => setAdding(false)}>
                  Done
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
