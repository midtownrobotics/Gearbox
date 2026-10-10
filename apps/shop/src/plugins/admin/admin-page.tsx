import { appUrl } from "@g3/site-config";
import { useTeamNames } from "@g3/ui";
import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { enableKioskMode } from "../../shared/kiosk";
import { PROCESS_TYPE_LABELS, type Process, type ProcessType } from "../../shared/types";
import { ErrorBanner, PageLoading } from "../../shared/ui";
import { useShopData } from "../../shared/use-shop-data";
import { ActionsLog } from "./actions-log";

export function AdminPage() {
  const { data, loading, error, refresh } = useShopData();
  const [banner, setBanner] = useState<string | null>(null);
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
    if (!window.confirm("Delete all obsolete instances? This cannot be undone.")) return;
    setDeletingObsolete(true);
    const res = await api.admin["obsolete-instances"].$delete();
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      setDeletingObsolete(false);
      return;
    }
    setBanner("Obsolete instances deleted successfully");
    setDeletingObsolete(false);
    await refresh();
  }

  if (loading) return <PageLoading />;

  return (
    <main className="min-h-screen bg-page">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-4xl text-ink">Admin</h1>
          <DailySlackButtons />
        </div>

        {error && <ErrorBanner message={error} />}
        {banner && <ErrorBanner message={banner} />}

        {/* Section 1: Actions Log */}
        <Section title="Actions Log" defaultOpen={false}>
          {data ? (
            <ActionsLog data={data} />
          ) : (
            <p className="text-sm text-steel">Loading shop data…</p>
          )}
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
        <Section title="Data Management" defaultOpen={false}>
          <button
            type="button"
            onClick={deleteObsoleteInstances}
            disabled={deletingObsolete}
            className="px-4 py-2 bg-crimson hover:bg-crimson-dark text-paper font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            {deletingObsolete ? "Deleting…" : "Delete Obsolete Instances"}
          </button>
          <p className="text-xs text-steel mt-2">
            Permanently removes all obsolete part instances, freeing their numbers for reuse.
          </p>
        </Section>

        {/* Section 4: Kiosk Mode */}
        <Section title="Kiosk Mode" defaultOpen={false}>
          <KioskModeSettings />
        </Section>

        {/* Section 5: OnShape Configuration */}
        <Section title="OnShape Configuration" defaultOpen={false}>
          {data ? <OnShapeConfig /> : <p className="text-sm text-steel">Loading…</p>}
        </Section>

        {/* Section 6: Slack channels, on the team's App settings page */}
        <Section title="Slack Configuration" defaultOpen={false}>
          <p className="text-sm text-steel">
            The channels for releases and daily summaries are on your team's{" "}
            <a
              href={`${appUrl("portal")}/admin/settings`}
              className="font-semibold text-crimson underline"
            >
              App settings
            </a>{" "}
            page. The Slack bot must be a member of each channel.
          </p>
        </Section>
      </div>
    </main>
  );
}

function KioskModeSettings() {
  const names = useTeamNames();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3 max-w-xl">
      <p className="text-sm text-steel-dark">
        Kiosk mode makes this device a shared station where members sign in with their 3-digit PIN.
        It signs you out and takes the device through {names.idName} kiosk activation. Name the
        kiosk after a machine (“Mill”) to open that machine's queue.
      </p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">
            You'll be logged out on this device. Continue?
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              enableKioskMode();
            }}
            className="px-3.5 py-2 bg-crimson hover:bg-crimson-dark text-paper text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            {busy ? "Switching…" : "Yes, enable kiosk mode"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="px-3.5 py-2 bg-steel-tint hover:bg-steel/30 text-steel-dark text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="px-3.5 py-2 bg-crimson hover:bg-crimson-dark text-paper text-sm font-semibold rounded-lg transition-colors"
        >
          Enable Kiosk Mode on This Device
        </button>
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
    <section className="bg-paper border border-steel/30 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left"
      >
        <span className="font-display text-2xl text-ink">{title}</span>
        <span className={`text-steel text-sm transition-transform ${open ? "rotate-180" : ""}`}>
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
      <h3 className="text-sm font-bold uppercase tracking-wider text-steel-dark">
        {title} <span className="text-steel font-normal">({items.length})</span>
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
          className="flex-1 bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
        />
        <button
          type="button"
          onClick={onAdd}
          className="px-3.5 py-2 bg-crimson hover:bg-crimson-dark text-paper text-sm font-semibold rounded-lg transition-colors"
        >
          Add
        </button>
      </div>
      <div className="space-y-1.5">
        {items.length === 0 && <p className="text-steel text-sm">None yet.</p>}
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 bg-mist border border-steel/20 rounded-lg px-3.5 py-2 text-sm text-ink"
          >
            <span className="flex-1 truncate">{item.name}</span>
            <button
              type="button"
              disabled
              title="Removal isn't available yet"
              className="text-steel/50 cursor-not-allowed px-1"
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
      className="bg-paper border border-steel/40 rounded-lg px-2 py-1 text-xs text-steel-dark focus:outline-none focus:border-crimson"
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
      className="flex items-center gap-1.5 text-xs text-steel-dark cursor-pointer select-none shrink-0"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-crimson w-3.5 h-3.5"
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
      <h3 className="text-sm font-bold uppercase tracking-wider text-steel-dark">
        Processes <span className="text-steel font-normal">({processes.length})</span>
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
          className="flex-1 min-w-0 bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
        />
        <ProcessTypeSelect value={draftType} onChange={setDraftType} label="New process type" />
        <PartInfoToggle checked={draftNeedsInfo} onChange={setDraftNeedsInfo} />
        <button
          type="button"
          onClick={onAdd}
          className="px-3.5 py-2 bg-crimson hover:bg-crimson-dark text-paper text-sm font-semibold rounded-lg transition-colors"
        >
          Add
        </button>
      </div>
      <div className="space-y-1.5">
        {processes.length === 0 && <p className="text-steel text-sm">None yet.</p>}
        {processes.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-2 bg-mist border border-steel/20 rounded-lg px-3.5 py-2 text-sm text-ink"
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

const inputCls =
  "w-full bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson";

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
      {banner && (
        <div
          className={`text-sm rounded-lg px-3 py-2 ${
            banner.ok
              ? "text-emerald-700 bg-emerald-50 border border-emerald-300"
              : "text-crimson-dark bg-crimson-50 border border-crimson-200"
          }`}
        >
          {banner.text}
        </div>
      )}

      {status?.fromWorkerSecrets && (
        <p className="text-xs text-steel">
          Using the built-in keys. Save your team's own to replace them.
        </p>
      )}

      <div className="p-3 bg-mist rounded-lg border border-steel/25 space-y-2">
        <p className="text-xs font-medium text-steel-dark">Quick Add from URL</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") parseUrl();
            }}
            placeholder="https://cad.onshape.com/documents/[...]/e/[...]"
            className="flex-1 bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
          />
          <button
            type="button"
            onClick={parseUrl}
            className="px-3 py-2 bg-paper border border-steel/40 hover:bg-steel-tint text-ink text-sm font-medium rounded-lg transition-colors"
          >
            Parse
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="doc-id" className="text-xs font-medium text-steel-dark">
          Document ID *
        </label>
        <input
          id="doc-id"
          type="text"
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
          placeholder="e.g. abc123def456"
          className={inputCls}
        />
        <p className="text-xs text-steel">
          From OnShape URL: cad.onshape.com/documents/[DOCUMENT_ID]/...
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="main-asm-id" className="text-xs font-medium text-steel-dark">
          Main Assembly ID
        </label>
        <input
          id="main-asm-id"
          type="text"
          value={mainAssemblyId}
          onChange={(e) => setMainAssemblyId(e.target.value)}
          placeholder="e.g. xyz789"
          className={inputCls}
        />
        <p className="text-xs text-steel">Needed to read the release's bill of materials</p>
      </div>

      <div className="space-y-1">
        <label htmlFor="company-id" className="text-xs font-medium text-steel-dark">
          Company ID
        </label>
        <input
          id="company-id"
          type="text"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          placeholder="The Onshape company (or classroom) that owns the document"
          className={inputCls}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="api-key" className="text-xs font-medium text-steel-dark">
            API access key
          </label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={inputCls}
          />
          <p className="text-xs text-steel">{keptHint(status?.hasApiKey)}</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="api-secret" className="text-xs font-medium text-steel-dark">
            API secret key
          </label>
          <input
            id="api-secret"
            type="password"
            autoComplete="off"
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            className={inputCls}
          />
          <p className="text-xs text-steel">{keptHint(status?.hasApiKey)}</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="webhook-primary" className="text-xs font-medium text-steel-dark">
            Webhook signing key (primary)
          </label>
          <input
            id="webhook-primary"
            type="password"
            autoComplete="off"
            value={webhookKeyPrimary}
            onChange={(e) => setWebhookKeyPrimary(e.target.value)}
            className={inputCls}
          />
          <p className="text-xs text-steel">{keptHint(status?.hasWebhookKeys)}</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="webhook-secondary" className="text-xs font-medium text-steel-dark">
            Webhook signing key (secondary)
          </label>
          <input
            id="webhook-secondary"
            type="password"
            autoComplete="off"
            value={webhookKeySecondary}
            onChange={(e) => setWebhookKeySecondary(e.target.value)}
            className={inputCls}
          />
          <p className="text-xs text-steel">{keptHint(status?.hasWebhookKeys)}</p>
        </div>
      </div>
      {status && (
        <p className="text-xs text-steel break-all">
          Saving registers Shop's webhook on the document, calling back on {status.webhookUrl}
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-crimson hover:bg-crimson-dark disabled:opacity-50 text-paper text-sm font-semibold rounded-lg transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
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
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(kind: keyof typeof SUMMARY_KINDS) {
    const { label, blurb } = SUMMARY_KINDS[kind];
    if (!window.confirm(`Post the ${label} (${blurb}) to the Slack summary channel?`)) return;
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
          <button
            key={kind}
            type="button"
            onClick={() => send(kind)}
            disabled={sending !== null}
            title={`Post the ${SUMMARY_KINDS[kind].label} to Slack: ${SUMMARY_KINDS[kind].blurb}`}
            className="px-4 py-2 bg-crimson hover:bg-crimson-dark disabled:opacity-50 text-paper text-sm font-semibold rounded-lg transition-colors"
          >
            {sending === kind ? "Sending…" : `Send ${SUMMARY_KINDS[kind].label}`}
          </button>
        ))}
      </div>
      {result && (
        <div
          className={`w-full text-xs rounded-lg px-3 py-2 whitespace-pre-wrap ${
            result.ok
              ? "text-emerald-800 bg-emerald-50 border border-emerald-300"
              : "text-crimson-dark bg-crimson-50 border border-crimson-200"
          }`}
        >
          {result.ok ? `Sent:\n${result.text}` : result.text}
        </div>
      )}
    </div>
  );
}
