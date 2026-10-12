import { Button, Card, ConfirmButton, ErrorBanner, Loading, Page, Stat, inputClass } from "@g3/ui";
import { useRef, useState } from "react";
import { getErrorMessage } from "../../shared/api";
import { formatDateTime } from "../../shared/format";
import { useLoad } from "../../shared/use-load";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
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
      `Uploaded ${file.name}.`,
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
            Sound starts when the door opens, repeats while it stays open, and stops when it closes.
          </p>
          <Button variant="secondary" onClick={state.reload}>
            Refresh status
          </Button>
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
          Upload a WAV file up to 10 MB. It joins the rotation right away.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={fileInput}
            type="file"
            accept=".wav,audio/wav,audio/x-wav"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className={`${inputClass} min-w-0 flex-1`}
          />
          <Button disabled={!file || busy !== null} onClick={() => void upload()}>
            {busy === "upload" ? "Uploading…" : "Upload sound"}
          </Button>
        </div>
      </Card>

      <Card title="Sounds on the Orange Pi">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-secondary-500">
            One sound plays at a time: a test or door opening replaces the one playing.
          </p>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() =>
              void act("stop", () => request("/stop", { method: "POST" }), "Stopped the sound.")
            }
          >
            {busy === "stop" ? "Stopping…" : "Stop sound"}
          </Button>
        </div>
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
                  <Button
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        `test-${sound.name}`,
                        () =>
                          request(`/sounds/${encodeURIComponent(sound.name)}/test`, {
                            method: "POST",
                          }),
                        `Playing ${sound.name} on the box.`,
                      )
                    }
                  >
                    {busy === `test-${sound.name}` ? "Playing…" : "Test on Orange Pi"}
                  </Button>
                  <ConfirmButton
                    label={busy === `delete-${sound.name}` ? "Deleting…" : "Delete"}
                    confirmLabel="Delete"
                    question={`Delete ${sound.name} from the box?`}
                    disabled={busy !== null}
                    onConfirm={() =>
                      void act(
                        `delete-${sound.name}`,
                        () =>
                          request(`/sounds/${encodeURIComponent(sound.name)}`, {
                            method: "DELETE",
                          }),
                        `Deleted ${sound.name}.`,
                      )
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}
