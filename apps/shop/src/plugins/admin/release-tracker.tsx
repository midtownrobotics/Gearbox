import { Button, ConfirmButton, ErrorBanner, Loading, SuccessBanner, TextField } from "@g3/ui";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";

type Studio = {
  name: string;
  url: string | null;
  released: number;
  unreleased: number;
  syncedAt: number | null;
  error: string | null;
};
type Tracker = {
  url: string;
  syncedAt: number | null;
  syncDueAt: number | null;
  syncing: boolean;
  error: string | null;
  otherDocument: boolean;
  studios: Studio[];
};

// The colors the "Released parts" feature gives parts in Onshape (its FeatureScript).
const COLORS = [
  { label: "Not released", color: "rgba(255, 115, 178, 0.5)" },
  { label: "Not started", color: "rgb(115, 120, 128)" },
  { label: "In progress", color: "rgb(204, 153, 26)" },
  { label: "Complete", color: "rgb(46, 158, 79)" },
];

function when(at: number) {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The Release Tracker section: a separate Onshape document with a copy of each part studio, its
 * parts colored by release and shop status. Shop keeps it up to date by itself.
 */
export function ReleaseTracker() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [url, setUrl] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.admin["release-tracker"].$get();
    if (!res.ok) return setError(await getErrorMessage(res as unknown as Response));
    const body = (await res.json()) as { ready: boolean; tracker: Tracker | null };
    setReady(body.ready);
    setTracker(body.tracker);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<Response>, message: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await action();
      if (!res.ok) throw new Error(await getErrorMessage(res));
      setDone(message);
      setChanging(false);
      setUrl("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const link = () =>
    run(
      () => api.admin["release-tracker"].$put({ json: { url } }) as unknown as Promise<Response>,
      "Linked. The first sync starts now and can take a few minutes.",
    );

  if (ready === null && !error) return <Loading />;

  const legend = (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary-600">
      {COLORS.map((c) => (
        <span key={c.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-3 w-3 rounded-sm border border-line"
            style={{ backgroundColor: c.color }}
          />
          {c.label}
        </span>
      ))}
    </div>
  );

  const linkForm = (
    <div className="space-y-2 max-w-xl">
      <TextField
        kind="url"
        aria-label="Tracking document address"
        placeholder="https://cad.onshape.com/documents/…/w/…"
        value={url}
        disabled={busy}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !url.trim()} onClick={link}>
          {busy ? "Linking…" : "Link document"}
        </Button>
        {changing && (
          <Button variant="secondary" disabled={busy} onClick={() => setChanging(false)}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-secondary-500">
        A separate Onshape document with a copy of every part studio, each part colored by how far
        along it is. Shop keeps it up to date within about 20 minutes of a change.
      </p>
      {legend}
      {error && <ErrorBanner message={error} />}
      {done && <SuccessBanner message={done} />}

      {!ready ? (
        <p className="text-sm text-secondary-600">
          Connect Onshape first, under Onshape Configuration.
        </p>
      ) : !tracker ? (
        <>
          <p className="text-sm text-secondary-700">
            Create an empty document in Onshape where your team will find it, share it with the
            account Shop's API keys belong to (with edit access), then paste its address.
          </p>
          {linkForm}
        </>
      ) : (
        <>
          {tracker.otherDocument && (
            <ErrorBanner message="Shop follows a different Onshape document now. Link the tracking document again to start over." />
          )}
          {tracker.error && <ErrorBanner message={tracker.error} />}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <a
              href={tracker.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary-700 hover:underline"
            >
              Open the tracking document
            </a>
            <span className="text-secondary-600">
              {tracker.syncing
                ? "Syncing…"
                : tracker.syncedAt
                  ? `Last synced ${when(tracker.syncedAt)}`
                  : "Not synced yet"}
              {tracker.syncDueAt && !tracker.syncing
                ? ` · next sync ${when(tracker.syncDueAt)}`
                : ""}
            </span>
          </div>

          {tracker.studios.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-secondary-500 border-b border-line">
                    <th className="py-1 pr-4 font-medium">Part studio</th>
                    <th className="py-1 pr-4 font-medium text-right">Released</th>
                    <th className="py-1 pr-4 font-medium text-right">Not released</th>
                  </tr>
                </thead>
                <tbody>
                  {tracker.studios.map((s) => (
                    <tr key={s.name} className="border-b border-line align-top">
                      <td className="py-1 pr-4 min-w-0">
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary-700 hover:underline"
                          >
                            {s.name}
                          </a>
                        ) : (
                          s.name
                        )}
                        {s.error && <div className="text-xs text-red-700">{s.error}</div>}
                      </td>
                      <td className="py-1 pr-4 text-right tabular-nums">{s.released}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">{s.unreleased}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {changing ? (
            linkForm
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={busy || tracker.syncing}
                onClick={() =>
                  run(
                    () => api.admin["release-tracker"].sync.$post() as unknown as Promise<Response>,
                    "Syncing now. It can take a few minutes.",
                  )
                }
              >
                Sync now
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setChanging(true)}>
                Change document
              </Button>
              <ConfirmButton
                label="Stop tracking"
                question="Stop the release tracker? The tracking document stays in Onshape but stops updating."
                confirmLabel="Stop it"
                disabled={busy}
                onConfirm={() =>
                  run(
                    () => api.admin["release-tracker"].$delete() as unknown as Promise<Response>,
                    "The release tracker is stopped.",
                  )
                }
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
