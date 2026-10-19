import { Button, Card, ConfirmButton, ErrorBanner, Loading, Page, Stat, inputClass } from "@g3/ui";
import type { SwitchClipSettings } from "@g3/worker-edge/switch-types";
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
    soundSettings: Record<string, SwitchClipSettings>;
    volumePercent: number;
    increaseVolume: boolean;
    volumeIncreasePercent: number;
    delaySeconds: number;
    selectedSounds: string[];
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
            Selected clips play in order with their own delays and volumes. Closing the door cuts
            off the clip or cancels the delay.
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

      <PlaybackSettings
        key={JSON.stringify([
          data.delaySeconds,
          data.selectedSounds,
          data.sounds,
          data.soundSettings,
          data.volumePercent,
          data.increaseVolume,
          data.volumeIncreasePercent,
        ])}
        initial={data}
        busy={busy !== null}
        save={(settings) =>
          act(
            "settings",
            () =>
              request("/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(settings),
              }),
            "Saved settings. Playback starts on the next door opening.",
          )
        }
      />
      <Card title="Upload a sound">
        <p className="mb-3 text-sm text-secondary-500">
          Upload a WAV file up to 10 MB. Select it in playback settings to include it.
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

type PlaybackSettingsValue = {
  selectedSounds: string[];
  soundSettings: Record<string, SwitchClipSettings>;
};
type ClipDraft = {
  delaySeconds: string;
  volumePercent: string;
  increaseVolume: boolean;
  volumeIncreasePercent: string;
};

function PlaybackSettings({
  initial,
  busy,
  save,
}: {
  initial: PlaybackSettingsValue & SwitchClipSettings & { sounds: { name: string }[] };
  busy: boolean;
  save(settings: PlaybackSettingsValue): Promise<boolean>;
}) {
  const [selected, setSelected] = useState(initial.selectedSounds);
  const [clips, setClips] = useState<Record<string, ClipDraft>>(() =>
    Object.fromEntries(
      initial.sounds.map(({ name }) => {
        const clip = initial.soundSettings[name] ?? initial;
        return [
          name,
          {
            delaySeconds: String(clip.delaySeconds),
            volumePercent: String(clip.volumePercent),
            increaseVolume: clip.increaseVolume,
            volumeIncreasePercent: String(clip.volumeIncreasePercent),
          },
        ];
      }),
    ),
  );
  const names = [
    ...selected,
    ...initial.sounds.map((sound) => sound.name).filter((name) => !selected.includes(name)),
  ];
  function update(name: string, patch: Partial<ClipDraft>) {
    setClips((current) => ({ ...current, [name]: { ...current[name], ...patch } }));
  }
  function move(index: number, direction: number) {
    const next = [...selected];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    setSelected(next);
  }
  return (
    <Card title="Playback settings">
      <p className="mb-3 text-sm text-secondary-500">
        Select clips and arrange their order. Each clip waits its own delay before playing,
        including repeats. One selected clip repeats alone; none stays silent. Closing the door
        cancels any delay and cuts off audio immediately.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save({
            selectedSounds: selected,
            soundSettings: Object.fromEntries(
              Object.entries(clips).map(([name, clip]) => [
                name,
                {
                  delaySeconds: Number(clip.delaySeconds),
                  volumePercent: Number(clip.volumePercent),
                  increaseVolume: clip.increaseVolume,
                  volumeIncreasePercent: Number(clip.volumeIncreasePercent),
                },
              ]),
            ),
          });
        }}
      >
        <div className="mb-3 space-y-3">
          {names.map((name) => {
            const index = selected.indexOf(name);
            const clip = clips[name];
            if (!clip) return null;
            return (
              <fieldset
                key={name}
                disabled={busy}
                aria-label={name}
                className="min-w-0 rounded-lg border border-secondary-200 p-3"
              >
                <div className="mb-3 flex items-start gap-2">
                  <label className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0"
                      checked={index >= 0}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selected, name]
                            : selected.filter((sound) => sound !== name),
                        )
                      }
                    />
                    <span className="break-all">
                      {index >= 0 ? `${index + 1}. ` : ""}
                      {name}
                    </span>
                  </label>
                  {index >= 0 && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Move ${name} up`}
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        ?
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Move ${name} down`}
                        disabled={busy || index === selected.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ?
                      </Button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="min-w-0 text-xs font-medium">
                    Delay before (sec)
                    <input
                      className={`${inputClass} mt-1 w-full min-w-0`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="3600"
                      step="0.1"
                      required
                      value={clip.delaySeconds}
                      onChange={(event) => update(name, { delaySeconds: event.target.value })}
                    />
                  </label>
                  <label className="min-w-0 text-xs font-medium">
                    Volume (%)
                    <input
                      className={`${inputClass} mt-1 w-full min-w-0`}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="100"
                      step="1"
                      required
                      value={clip.volumePercent}
                      onChange={(event) => update(name, { volumePercent: event.target.value })}
                    />
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0"
                      checked={clip.increaseVolume}
                      onChange={(event) => update(name, { increaseVolume: event.target.checked })}
                    />
                    Louder than previous
                  </label>
                  <label className="min-w-0 text-xs font-medium">
                    Increase (points)
                    <input
                      className={`${inputClass} mt-1 w-full min-w-0`}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="100"
                      step="1"
                      required
                      disabled={!clip.increaseVolume || busy}
                      value={clip.volumeIncreasePercent}
                      onChange={(event) =>
                        update(name, { volumeIncreasePercent: event.target.value })
                      }
                    />
                  </label>
                </div>
              </fieldset>
            );
          })}
        </div>
        <p className="mb-3 text-xs text-secondary-500">
          ?Louder than previous? uses the previous clip?s volume plus this clip?s increase, capped
          at 100%. The first clip starts at its own volume on each opening. Otherwise, each clip
          uses its own volume. Tests use the saved clip volume immediately. 0% is silent; 100% keeps
          the original level. Volume control requires uncompressed PCM or floating-point WAVs;
          recordings can differ in loudness. Saving stops playback until the next opening.
        </p>
        <Button type="submit" disabled={busy} className="w-full sm:w-auto">
          Save playback settings
        </Button>
      </form>
    </Card>
  );
}
