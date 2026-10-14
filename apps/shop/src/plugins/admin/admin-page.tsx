import {
  Button,
  ConfirmButton,
  ErrorBanner,
  Field,
  Loading,
  Page,
  SlackChannelPicker,
  SuccessBanner,
  focusRing,
  inputClass,
  useTeamNames,
} from "@g3/ui";
import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { enableKioskMode } from "../../shared/kiosk";
import { PROCESS_TYPE_LABELS, type Process, type ProcessType } from "../../shared/types";
import { useAuthUser } from "../../shared/use-auth";
import { useShopData } from "../../shared/use-shop-data";
import { ActionsLog } from "./actions-log";

export function AdminPage() {
  const { data, loading, error, refresh } = useShopData();
  // The Onshape, Slack and data sections and the Slack buttons only work for an admin.
  const isAdmin = useAuthUser()?.isAdmin ?? false;
  const [banner, setBanner] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [deletingObsolete, setDeletingObsolete] = useState(false);

  const [newSubsystem, setNewSubsystem] = useState("");
  const [newProcess, setNewProcess] = useState("");
  const [newProcessType, setNewProcessType] = useState<ProcessType>("regular");
  const [newProcessNeedsInfo, setNewProcessNeedsInfo] = useState(false);

  async function addSubsystem() {
    if (!newSubsystem.trim()) return;
    const res = await api.subsystems.$post({ json: { name: newSubsystem.trim() } });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    setNewSubsystem("");
    setBanner(null);
    await refresh();
  }

  async function addProcess() {
    if (!newProcess.trim()) return;
    const res = await api.processes.$post({
      json: {
        name: newProcess.trim(),
        type: newProcessType,
        requiresPartInfo: newProcessNeedsInfo,
      },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    setNewProcess("");
    setNewProcessType("regular");
    setNewProcessNeedsInfo(false);
    setBanner(null);
    await refresh();
  }

  // Show process edits immediately; the shop-data refresh behind them is slow, and until it
  // lands the controlled inputs would otherwise snap back to the old values.
  type ProcessEdit = { type?: ProcessType; requiresPartInfo?: boolean };
  const [pendingEdits, setPendingEdits] = useState<Record<number, ProcessEdit>>({});

  function clearPending(id: number, edit: ProcessEdit) {
    // Drop only the fields this edit set, and only if a newer edit hasn't replaced them.
    setPendingEdits(({ [id]: current = {}, ...rest }) => {
      const next = { ...current };
      for (const key of Object.keys(edit) as (keyof ProcessEdit)[]) {
        if (next[key] === edit[key]) delete next[key];
      }
      return Object.keys(next).length ? { ...rest, [id]: next } : rest;
    });
  }

  async function updateProcess(id: number, edit: ProcessEdit) {
    setPendingEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...edit } }));
    const res = await api.processes[":id"].$patch({ param: { id: String(id) }, json: edit });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      clearPending(id, edit);
      return;
    }
    setBanner(null);
    await refresh();
    clearPending(id, edit);
  }

  async function deleteObsoleteInstances() {
    setDeletingObsolete(true);
    setDone(null);
    const res = await api.admin["obsolete-instances"].$delete();
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      setDeletingObsolete(false);
      return;
    }
    setBanner(null);
    setDone("Obsolete instances deleted.");
    setDeletingObsolete(false);
    await refresh();
  }

  if (loading)
    return (
      <Page title="Admin">
        <Loading />
      </Page>
    );

  return (
    <Page title="Admin" actions={isAdmin && <DailySlackButtons />}>
      <>
        {error && <ErrorBanner message={error} />}
        {banner && <ErrorBanner message={banner} />}
        {done && <SuccessBanner message={done} />}

        {/* Section 1: Actions Log */}
        <Section title="Actions Log" defaultOpen={false}>
          {data ? <ActionsLog data={data} /> : <Loading />}
        </Section>

        {/* Section 2: Shop Settings */}
        <Section title="Shop Settings" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <NameList
              title="Subsystems"
              items={(data?.subsystems ?? []).map((s) => ({ id: s.id, name: s.name }))}
              draft={newSubsystem}
              setDraft={setNewSubsystem}
              onAdd={addSubsystem}
              placeholder="New subsystem"
            />
            <ProcessList
              processes={(data?.processes ?? []).map((p) => {
                const edit = pendingEdits[p.id];
                return {
                  ...p,
                  type: edit?.type ?? p.type,
                  requiresPartInfo:
                    edit?.requiresPartInfo === undefined
                      ? p.requiresPartInfo
                      : Number(edit.requiresPartInfo),
                };
              })}
              draft={newProcess}
              setDraft={setNewProcess}
              draftType={newProcessType}
              setDraftType={setNewProcessType}
              draftNeedsInfo={newProcessNeedsInfo}
              setDraftNeedsInfo={setNewProcessNeedsInfo}
              onAdd={addProcess}
              onUpdate={updateProcess}
            />
          </div>
        </Section>

        {/* Section 3: Data Management */}
        {isAdmin && (
          <Section title="Data Management" defaultOpen={false}>
            <div className="flex flex-wrap items-center gap-2">
              <ConfirmButton
                label={deletingObsolete ? "Deleting…" : "Delete obsolete instances"}
                question="Delete every obsolete part instance? This can't be undone."
                confirmLabel="Delete them"
                disabled={deletingObsolete}
                onConfirm={deleteObsoleteInstances}
              />
            </div>
            <p className="text-xs text-secondary-500 mt-2">
              Their numbers become free to use again.
            </p>
          </Section>
        )}

        {/* Section 4: Kiosk Mode */}
        <Section title="Kiosk Mode" defaultOpen={false}>
          <KioskModeSettings />
        </Section>

        {/* Section 5: Onshape */}
        {isAdmin && (
          <Section title="Onshape Configuration" defaultOpen={false}>
            {data ? <OnShapeConfig /> : <Loading />}
          </Section>
        )}

        {/* Section 6: Slack */}
        {isAdmin && (
          <Section title="Slack Configuration" defaultOpen={false}>
            <SlackSettings />
          </Section>
        )}
      </>
    </Page>
  );
}

function KioskModeSettings() {
  const names = useTeamNames();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3 max-w-xl">
      <p className="text-sm text-secondary-500">
        Kiosk mode makes this device a shared station where members sign in with their 3-digit PIN.
        It signs you out and takes the device through {names.idName} kiosk activation. Name the
        kiosk after a machine (“Mill”) to open that machine's queue.
      </p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-secondary-900">
            You'll be signed out on this device. Continue?
          </span>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              enableKioskMode();
            }}
          >
            {busy ? "Switching…" : "Yes, enable kiosk mode"}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)}>Enable kiosk mode on this device</Button>
      )}
    </div>
  );
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-surface border border-secondary-200 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`w-full flex items-center justify-between rounded-xl px-5 py-3.5 text-left ${focusRing}`}
      >
        <h2 className="text-2xl text-secondary-900">{title}</h2>
        <span
          className={`text-secondary-400 text-sm transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▼
        </span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}

function NameList({
  title,
  items,
  draft,
  setDraft,
  onAdd,
  placeholder,
}: {
  title: string;
  items: { id: number; name: string }[];
  draft: string;
  setDraft: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-sans text-sm font-bold uppercase tracking-wider text-secondary-500">
        {title} <span className="text-secondary-400 font-normal">({items.length})</span>
      </h3>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
          className={`${inputClass} flex-1`}
        />
        <Button onClick={onAdd}>Add</Button>
      </div>
      <div className="space-y-1.5">
        {items.length === 0 && <p className="text-secondary-400 text-sm">None yet.</p>}
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 bg-page border border-secondary-200 rounded-lg px-3.5 py-2 text-sm text-secondary-900"
          >
            <span className="flex-1 truncate">{item.name}</span>
            <button
              type="button"
              disabled
              title="Removal isn't available yet"
              className="text-secondary-300 cursor-not-allowed px-1"
              aria-label={`Remove ${item.name}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const PROCESS_TYPE_OPTIONS = Object.entries(PROCESS_TYPE_LABELS) as [ProcessType, string][];

function ProcessTypeSelect({
  value,
  onChange,
  label,
}: {
  value: ProcessType;
  onChange: (type: ProcessType) => void;
  label: string;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value as ProcessType)}
      className="bg-surface border border-secondary-300 rounded-lg px-2 py-1 text-xs text-secondary-500 focus:outline-none focus:border-primary-500"
    >
      {PROCESS_TYPE_OPTIONS.map(([type, typeLabel]) => (
        <option key={type} value={type}>
          {typeLabel}
        </option>
      ))}
    </select>
  );
}

function PartInfoToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      title="Require additional part information (material + thickness) at ingest"
      className="flex items-center gap-1.5 text-xs text-secondary-500 cursor-pointer select-none shrink-0"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary-500 w-3.5 h-3.5"
      />
      Part info
    </label>
  );
}

function ProcessList({
  processes,
  draft,
  setDraft,
  draftType,
  setDraftType,
  draftNeedsInfo,
  setDraftNeedsInfo,
  onAdd,
  onUpdate,
}: {
  processes: Process[];
  draft: string;
  setDraft: (v: string) => void;
  draftType: ProcessType;
  setDraftType: (t: ProcessType) => void;
  draftNeedsInfo: boolean;
  setDraftNeedsInfo: (v: boolean) => void;
  onAdd: () => void;
  onUpdate: (id: number, edit: { type?: ProcessType; requiresPartInfo?: boolean }) => void;
}) {
  return (
    <div className="space-y-3">
      <h3 className="font-sans text-sm font-bold uppercase tracking-wider text-secondary-500">
        Processes <span className="text-secondary-400 font-normal">({processes.length})</span>
      </h3>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="New process (e.g. Welding)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
          className={`${inputClass} flex-1 min-w-0`}
        />
        <ProcessTypeSelect value={draftType} onChange={setDraftType} label="New process type" />
        <PartInfoToggle checked={draftNeedsInfo} onChange={setDraftNeedsInfo} />
        <Button onClick={onAdd}>Add</Button>
      </div>
      <div className="space-y-1.5">
        {processes.length === 0 && <p className="text-secondary-400 text-sm">None yet.</p>}
        {processes.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2 bg-page border border-secondary-200 rounded-lg px-3.5 py-2 text-sm text-secondary-900"
          >
            <span className="flex-1 truncate">{p.name}</span>
            <PartInfoToggle
              checked={!!p.requiresPartInfo}
              onChange={(requiresPartInfo) => onUpdate(p.id, { requiresPartInfo })}
            />
            <ProcessTypeSelect
              value={p.type}
              onChange={(type) => onUpdate(p.id, { type })}
              label={`Type for ${p.name}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

type OnShapeStatus = {
  documentId: string;
  mainAssemblyId: string;
  companyId: string;
  hasApiKey: boolean;
  hasWebhookKeys: boolean;
  fromWorkerSecrets: boolean;
  webhookUrl: string;
};

/**
 * The team's Onshape connection: the document Shop follows, and the team's own API keys and
 * webhook signing keys from Onshape's Developer Portal. Keys are never shown again once saved;
 * leave them blank to keep them.
 */
function OnShapeConfig() {
  const [documentId, setDocumentId] = useState("");
  const [mainAssemblyId, setMainAssemblyId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [webhookKeyPrimary, setWebhookKeyPrimary] = useState("");
  const [webhookKeySecondary, setWebhookKeySecondary] = useState("");
  const [status, setStatus] = useState<OnShapeStatus | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  function parseUrl() {
    // Format: https://cad.onshape.com/documents/[DOCID]/[not used]/[not used]/e/[MAINASSEMBLYID]
    const match = urlInput.match(/\/documents\/([^/]+)\/[^/]*\/[^/]*\/e\/([^/?]+)/);
    if (!match) {
      setBanner({
        ok: false,
        text: "Invalid URL format. Expected: https://cad.onshape.com/documents/[DOCID]/[...]/e/[MAINASSEMBLYID]",
      });
      return;
    }

    const [, docId, assemblyId] = match;
    setDocumentId(docId);
    setMainAssemblyId(assemblyId);
    setUrlInput("");
    setBanner(null);
  }

  async function loadConfig() {
    try {
      const res = await api.admin.onshape.config.$get();
      if (!res.ok) {
        setBanner({ ok: false, text: await getErrorMessage(res as unknown as Response) });
        return;
      }
      const config = (await res.json()) as OnShapeStatus;
      setStatus(config);
      setDocumentId(config.documentId || "");
      setMainAssemblyId(config.mainAssemblyId || "");
      setCompanyId(config.companyId || "");
    } catch (err) {
      setBanner({
        ok: false,
        text: err instanceof Error ? err.message : "Failed to load OnShape config",
      });
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once
  useEffect(() => {
    void loadConfig();
  }, []);

  async function handleSave() {
    if (!documentId.trim()) {
      setBanner({ ok: false, text: "Document ID is required" });
      return;
    }

    setSaving(true);
    try {
      const res = await api.admin.onshape.config.$post({
        json: {
          documentId: documentId.trim(),
          mainAssemblyId: mainAssemblyId.trim() || undefined,
          companyId: companyId.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
          apiSecret: apiSecret.trim() || undefined,
          webhookKeyPrimary: webhookKeyPrimary.trim() || undefined,
          webhookKeySecondary: webhookKeySecondary.trim() || undefined,
        },
      });

      if (!res.ok) {
        setBanner({ ok: false, text: await getErrorMessage(res as unknown as Response) });
        return;
      }
      const result = (await res.json()) as { webhook?: string };
      setApiKey("");
      setApiSecret("");
      setWebhookKeyPrimary("");
      setWebhookKeySecondary("");
      setBanner(
        result.webhook === "registered"
          ? { ok: true, text: "Saved. Onshape will send releases to Shop." }
          : result.webhook === "failed"
            ? {
                ok: false,
                text: "Saved, but Onshape refused the webhook. Check the keys and company.",
              }
            : { ok: true, text: "Saved. Add the API keys and company ID to receive releases." },
      );
      await loadConfig();
    } catch (err) {
      setBanner({ ok: false, text: err instanceof Error ? err.message : "Failed to save config" });
    } finally {
      setSaving(false);
    }
  }

  const keptHint = (saved: boolean | undefined) =>
    saved ? "Saved; leave blank to keep it" : "From Onshape's Developer Portal";

  return (
    <div className="space-y-4 max-w-xl">
      {banner &&
        (banner.ok ? (
          <SuccessBanner message={banner.text} />
        ) : (
          <ErrorBanner message={banner.text} />
        ))}

      {status?.fromWorkerSecrets && (
        <p className="text-xs text-secondary-500">
          Using the built-in keys. Save your team's own to replace them.
        </p>
      )}

      <div className="p-3 bg-page rounded-lg border border-secondary-200 space-y-2">
        <p className="text-sm font-medium text-secondary-700">
          Fill in from the document's address
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") parseUrl();
            }}
            placeholder="https://cad.onshape.com/documents/[...]/e/[...]"
            className={`${inputClass} flex-1`}
          />
          <Button variant="secondary" onClick={parseUrl}>
            Fill in
          </Button>
        </div>
      </div>

      <Field
        label="Document ID"
        hint="From the document's address: cad.onshape.com/documents/[DOCUMENT_ID]/..."
      >
        <input
          type="text"
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
          placeholder="e.g. abc123def456"
          className={inputClass}
        />
      </Field>

      <Field
        label="Main Assembly ID"
        hint="Optional: fills in how many of each part a release needs"
      >
        <input
          type="text"
          value={mainAssemblyId}
          onChange={(e) => setMainAssemblyId(e.target.value)}
          placeholder="e.g. xyz789"
          className={inputClass}
        />
      </Field>

      <Field label="Company ID">
        <input
          type="text"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          placeholder="The Onshape company (or classroom) that owns the document"
          className={inputClass}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="API access key" hint={keptHint(status?.hasApiKey)}>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="API secret key" hint={keptHint(status?.hasApiKey)}>
          <input
            type="password"
            autoComplete="off"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Webhook signing key (primary)" hint={keptHint(status?.hasWebhookKeys)}>
          <input
            type="password"
            autoComplete="off"
            value={webhookKeyPrimary}
            onChange={(e) => setWebhookKeyPrimary(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Webhook signing key (secondary)" hint={keptHint(status?.hasWebhookKeys)}>
          <input
            type="password"
            autoComplete="off"
            value={webhookKeySecondary}
            onChange={(e) => setWebhookKeySecondary(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      {status && (
        <p className="text-xs text-secondary-400 break-all">
          Saving registers Shop's webhook on the document, calling back on {status.webhookUrl}
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

const SUMMARY_KINDS = {
  overview: { label: "Overview", blurb: "where the work is waiting and which machines need help" },
  reflection: { label: "Reflection", blurb: "what got done today" },
} as const;

function DailySlackButtons() {
  const [sending, setSending] = useState<keyof typeof SUMMARY_KINDS | null>(null);
  const [asking, setAsking] = useState<keyof typeof SUMMARY_KINDS | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(kind: keyof typeof SUMMARY_KINDS) {
    setAsking(null);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    setSending(kind);
    setResult(null);
    try {
      const res = await api.admin.slack["daily-summary"].$post({
        json: {
          kind,
          since: startOfDay.getTime(),
          dayLabel: startOfDay.toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          }),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      if (!res.ok) {
        setResult({ ok: false, text: await getErrorMessage(res as unknown as Response) });
        return;
      }
      const { text } = (await res.json()) as { text: string };
      setResult({ ok: true, text });
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : "Failed to send" });
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2 max-w-md">
      <div className="flex gap-2">
        {(Object.keys(SUMMARY_KINDS) as (keyof typeof SUMMARY_KINDS)[]).map((kind) => (
          <Button
            key={kind}
            variant="secondary"
            onClick={() => {
              setResult(null);
              setAsking(kind);
            }}
            disabled={sending !== null}
          >
            {sending === kind ? "Sending…" : `Send ${SUMMARY_KINDS[kind].label}`}
          </Button>
        ))}
      </div>
      {asking && (
        <div className="w-full space-y-2 rounded-lg border border-secondary-200 bg-surface p-3">
          <p className="text-sm text-secondary-900">
            Post the {SUMMARY_KINDS[asking].label} ({SUMMARY_KINDS[asking].blurb}) to the Slack
            summary channel?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => send(asking)}>
              Post it
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAsking(null)}>
              Don't post
            </Button>
          </div>
        </div>
      )}
      {result &&
        (result.ok ? (
          <p
            role="status"
            className="w-full whitespace-pre-wrap rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
          >
            {`Sent:\n${result.text}`}
          </p>
        ) : (
          <ErrorBanner message={result.text} />
        ))}
    </div>
  );
}

function SlackSettings() {
  const [channelId, setChannelId] = useState("");
  const [summaryChannelId, setSummaryChannelId] = useState("");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: workaround for Hono client type generation
      const res = await (api as any).admin.slack.config.$get();
      if (!res.ok) {
        setBanner(await getErrorMessage(res as unknown as Response));
        return;
      }
      const config = (await res.json()) as {
        slackReleaseChannelId: string;
        slackSummaryChannelId: string;
      };
      setChannelId(config.slackReleaseChannelId || "");
      setSummaryChannelId(config.slackSummaryChannelId || "");
      setBanner(null);
      setLoaded(true);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Failed to load Slack config");
    }
  }

  async function handleSave() {
    if (!channelId.trim()) {
      setBanner("Choose the release notification channel");
      return;
    }

    setSaving(true);
    setSaved(false);
    try {
      // biome-ignore lint/suspicious/noExplicitAny: workaround for Hono client type generation
      const res = await (api as any).admin.slack.config.$post({
        json: {
          slackReleaseChannelId: channelId.trim(),
          slackSummaryChannelId: summaryChannelId.trim(),
        },
      });

      if (!res.ok) {
        setBanner(await getErrorMessage(res as unknown as Response));
        return;
      }

      setBanner(null);
      setSaved(true);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return banner ? <ErrorBanner message={banner} /> : <Loading />;

  return (
    <div className="space-y-4 max-w-xl">
      {banner && <ErrorBanner message={banner} />}
      {saved && <SuccessBanner message="Slack channels saved." />}

      <div className="space-y-1">
        <label htmlFor="channel-id" className="block text-sm font-medium text-secondary-700">
          Release notification channel *
        </label>
        <SlackChannelPicker
          app="shop"
          id="channel-id"
          value={channelId}
          onChange={(id) => setChannelId(id ?? "")}
          clearable={false}
        />
        <p className="text-xs text-secondary-500">Where new Onshape releases are posted.</p>
      </div>

      <div className="space-y-1">
        <label
          htmlFor="summary-channel-id"
          className="block text-sm font-medium text-secondary-700"
        >
          Overview &amp; Reflection channel
        </label>
        <SlackChannelPicker
          app="shop"
          id="summary-channel-id"
          value={summaryChannelId}
          onChange={(id) => setSummaryChannelId(id ?? "")}
        />
        <p className="text-xs text-secondary-500">
          Where the Overview and Reflection buttons post.
        </p>
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="secondary" onClick={loadConfig}>
          Reload
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
