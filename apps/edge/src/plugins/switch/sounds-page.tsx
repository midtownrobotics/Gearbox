import { useRef, useState } from "react";
import { getErrorMessage } from "../../shared/api";
import { formatDateTime } from "../../shared/format";
import { Card, ErrorBanner, Loading, Page, Stat } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const button =
  "rounded-lg border border-secondary-300 px-3 py-2 text-sm font-medium text-secondary-700 hover:bg-secondary-50 disabled:opacity-50";
const primaryButton =
  "rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}/switch${path}`, {
    ...init,
    credentials: "include",
  });
  if (!response.ok) throw new Error(await getErrorMessage(response));
  return response.json();
}

async function loadState() {
  return request("/state") as Promise<{
    input: "gpio" | "placeholder";
    gpio: string | null;
    audioDevice: string;
    grounded: boolean;
    triggerCount: number;
    lastTriggeredAt: number | null;
    lastSound: string | null;
    lastError: string | null;
    sounds: { name: string; size: number }[];
  }>;
}

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function DoorSoundsPage() {
  const state = useLoad(loadState, []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    setActionError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      state.reload();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function upload() {
    if (!file) return;
    const uploaded = await act(
      "upload",
      () =>
        request(`/sounds?name=${encodeURIComponent(file.name)}`, {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: file,
        }),
      `Uploaded ${file.name}. It is now included in the door-opening sound rotation.`,
    );
    if (!uploaded) return;
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  if (state.error) {
    return (
      <Page title="Door Sounds">
        <ErrorBanner message={state.error} />
      </Page>
    );
  }
  if (!state.data) {
    return (
      <Page title="Door Sounds">
        <Loading />
      </Page>
    );
  }

  const data = state.data;
  return (
    <Page title="Door Sounds">
      {actionError && <ErrorBanner message={actionError} />}
      {message && (
        <p className="break-words rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          {message}
        </p>
      )}

      <Card title="Door switch">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-secondary-500">
            Automatic sound plays only when the door opens.
          </p>
          <button type="button" className={button} onClick={state.reload}>
            Refresh status
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Door" value={data.grounded ? "Closed" : "Open"} />
          <Stat label="Openings" value={data.triggerCount} />
          <Stat
            label="Last opened"
            value={data.lastTriggeredAt ? formatDateTime(data.lastTriggeredAt) : "Never"}
          />
        </div>
        <dl className="mt-5 grid gap-4 border-t border-secondary-100 pt-4 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs font-bold uppercase tracking-widest text-secondary-400">
              Input
            </dt>
            <dd className="mt-1 break-words text-sm text-secondary-900">
              {data.input === "gpio" ? (data.gpio ?? "GPIO") : "Mock input"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-bold uppercase tracking-widest text-secondary-400">
              Audio output
            </dt>
            <dd className="mt-1 break-all font-mono text-sm text-secondary-900">
              {data.audioDevice}
            </dd>
          </div>
          {data.lastSound && (
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs font-bold uppercase tracking-widest text-secondary-400">
                Last sound
              </dt>
              <dd className="mt-1 break-all text-sm text-secondary-900">
                {data.lastSound.split(/[\\/]/).pop()}
              </dd>
            </div>
          )}
        </dl>
        {data.lastError && (
          <div className="mt-4 break-words">
            <ErrorBanner message={data.lastError} />
          </div>
        )}
      </Card>

      <Card title="Upload a sound">
        <p className="mb-3 text-sm text-secondary-500">
          Upload a RIFF/WAVE file up to 10 MB. Uploaded sounds join the rotation immediately;
          restarting the edge agent is not required.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={fileInput}
            type="file"
            accept=".wav,audio/wav,audio/x-wav"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="min-w-0 flex-1 rounded-lg border border-secondary-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            className={primaryButton}
            disabled={!file || busy !== null}
            onClick={() => void upload()}
          >
            {busy === "upload" ? "Uploading…" : "Upload sound"}
          </button>
        </div>
      </Card>

      <Card title="Sounds on the Orange Pi">
        {data.sounds.length === 0 ? (
          <p className="text-sm text-secondary-500">No uploaded sounds yet.</p>
        ) : (
          <div className="divide-y divide-secondary-100">
            {data.sounds.map((sound) => (
              <div
                key={sound.name}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-all font-medium text-secondary-900">{sound.name}</p>
                  <p className="text-xs text-secondary-500">{bytes(sound.size)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={button}
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        `test-${sound.name}`,
                        () =>
                          request(`/sounds/${encodeURIComponent(sound.name)}/test`, {
                            method: "POST",
                          }),
                        `Played ${sound.name} on the Orange Pi.`,
                      )
                    }
                  >
                    {busy === `test-${sound.name}` ? "Playing…" : "Test on Orange Pi"}
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        `delete-${sound.name}`,
                        () =>
                          request(`/sounds/${encodeURIComponent(sound.name)}`, {
                            method: "DELETE",
                          }),
                        `Deleted ${sound.name}.`,
                      )
                    }
                  >
                    {busy === `delete-${sound.name}` ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}
