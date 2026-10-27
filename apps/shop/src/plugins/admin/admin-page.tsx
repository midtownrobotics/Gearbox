import {
  Badge,
  Button,
  ChannelPicker,
  ConfirmButton,
  ConfirmQuestion,
  ErrorBanner,
  Field,
  Loading,
  Page,
  SuccessBanner,
  Switch,
  TextField,
  chatName,
  focusRing,
  inputClass,
  useTeamChat,
} from "@g3/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { InfoTip } from "../../shared/info-tip";
import { enableKioskMode } from "../../shared/kiosk";
import { refreshOnshapeStatus } from "../../shared/onshape-banner";
import {
  PROCESS_TYPE_LABELS,
  type Process,
  type ProcessType,
  type Removal,
  type Usage,
} from "../../shared/types";
import { useAuthUser, useRefreshAuthUser } from "../../shared/use-auth";
import { useShopData } from "../../shared/use-shop-data";
import { ActionsLog } from "./actions-log";
import { sectionHeading } from "./admin-styles";
import { OnshapeUsage } from "./onshape-usage";
import { QualityReports } from "./quality-reports";
import { StatusLevelsSettings } from "./status-levels";

export function AdminPage() {
  const { data, loading, error, refresh } = useShopData();
  const user = useAuthUser();
  // The Onshape, chat and data sections, the summary buttons, and adding and removing subsystems
  // and processes only work for an admin.
  const isAdmin = user?.isAdmin ?? false;
  // A required quality check is at the end of every part, so it can't be removed while it is.
  const requiredCheck = user?.qualityCheck.required ? user.qualityCheck.processId : null;
  const chat = chatName(useTeamChat());
  const [banner, setBanner] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [deletingObsolete, setDeletingObsolete] = useState(false);

  const [newSubsystem, setNewSubsystem] = useState("");
  const [newProcess, setNewProcess] = useState("");
  const [newProcessType, setNewProcessType] = useState<ProcessType>("regular");
  const [newProcessNeedsInfo, setNewProcessNeedsInfo] = useState(false);

  // How many parts use each subsystem and process, so Remove can say what it will do.
  const [usage, setUsage] = useState<{
    subsystems: Record<string, Usage>;
    processes: Record<string, Usage>;
  } | null>(null);
  const loadUsage = useCallback(async () => {
    if (!isAdmin) return;
    const [subsystems, processes] = await Promise.all([
      api.subsystems.usage.$get(),
      api.processes.usage.$get(),
    ]);
    if (!subsystems.ok || !processes.ok) return;
    setUsage({
      subsystems: (await subsystems.json()) as Record<string, Usage>,
      processes: (await processes.json()) as Record<string, Usage>,
    });
  }, [isAdmin]);
  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  async function removeItem(kind: "subsystem" | "process", id: number) {
    const param = { id: String(id) };
    const res =
      kind === "subsystem"
        ? await api.subsystems[":id"].$delete({ param })
        : await api.processes[":id"].$delete({ param });
    if (!res.ok) {
      setDone(null);
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    const removed = (await res.json()) as Removal;
    setBanner(null);
    setDone(
      removed.outcome === "deleted"
        ? `Deleted ${removed.name}.`
        : `Removed ${removed.name}: it's hidden from new parts.`,
    );
    await Promise.all([refresh(), loadUsage()]);
  }

  async function restoreItem(kind: "subsystem" | "process", id: number) {
    const param = { id: String(id) };
    const res =
      kind === "subsystem"
        ? await api.subsystems[":id"].restore.$post({ param })
        : await api.processes[":id"].restore.$post({ param });
    if (!res.ok) {
      setDone(null);
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    const restored = (await res.json()) as { name: string };
    setBanner(null);
    setDone(`Restored ${restored.name}.`);
    await refresh();
  }

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
    <Page title="Admin" actions={isAdmin && <DailySummaryButtons chat={chat} />}>
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
              items={data?.subsystems ?? []}
              draft={newSubsystem}
              setDraft={setNewSubsystem}
              onAdd={addSubsystem}
              placeholder="New subsystem"
              isAdmin={isAdmin}
              usage={usage?.subsystems}
              onRemove={(id) => removeItem("subsystem", id)}
              onRestore={(id) => restoreItem("subsystem", id)}
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
              isAdmin={isAdmin}
              usage={usage?.processes}
              requiredCheck={requiredCheck}
              onRemove={(id) => removeItem("process", id)}
              onRestore={(id) => restoreItem("process", id)}
            />
          </div>
        </Section>

        {/* Section 3: Quality Control */}
        {isAdmin && (
          <Section title="Quality Control" defaultOpen={false}>
            <QualityControlSettings />
          </Section>
        )}

        {isAdmin && (
          <Section title="Shop Status" defaultOpen={false}>
            <StatusLevelsSettings />
          </Section>
        )}

        {/* Section 4: Data Management */}
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

        {/* Section 5: Kiosk Mode */}
        <Section title="Kiosk Mode" defaultOpen={false}>
          <KioskModeSettings />
        </Section>

        {/* Section 6: Onshape */}
        {isAdmin && (
          <Section title="Onshape Configuration" defaultOpen={false}>
            {data ? <OnShapeConfig /> : <Loading />}
          </Section>
        )}

        {/* Opened by the Onshape banner's link (`#onshape`). */}
        {isAdmin && (
          <Section title="Onshape API Usage" id="onshape" defaultOpen={false}>
            <OnshapeUsage />
          </Section>
        )}

        {/* Section 7: the team's chat (Slack or Discord) */}
        {isAdmin && (
          <Section title={`${chat} Configuration`} defaultOpen={false}>
            <ChannelSettings />
          </Section>
        )}
      </>
    </Page>
  );
}

type QualityState = {
  requireQualityCheck: boolean;
  qualityProcessId: number | null;
  qualityProcesses: { id: number; name: string }[];
  people: {
    id: string;
    displayName: string;
    isAdmin: boolean;
    isMentor: boolean;
    isManager: boolean;
  }[];
  peopleLoaded: boolean;
};

/** Picks someone who isn't a shop manager yet, by typing a name or opening the list. */
function PersonPicker({
  people,
  disabled,
  onPick,
}: {
  people: { id: string; displayName: string; isAdmin: boolean; isMentor: boolean }[];
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const listId = "shop-manager-options";
  const term = query.trim().toLowerCase();
  const matches = term ? people.filter((p) => p.displayName.toLowerCase().includes(term)) : people;

  function pick(id: string) {
    onPick(id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative max-w-sm">
      <TextField
        typeable
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Add a shop manager"
        autoComplete="off"
        disabled={disabled}
        value={query}
        placeholder={people.length === 0 ? "Everyone is a shop manager" : "Add a shop manager…"}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && matches.length > 0) pick(matches[0].id);
        }}
      />
      {open && people.length > 0 && (
        <div
          id={listId}
          role="listbox"
          // The box keeps the focus; the list is only reached through it.
          tabIndex={-1}
          aria-label="People who aren't shop managers"
          className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-surface border border-secondary-300 rounded-lg shadow-lg"
        >
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-secondary-500">Nobody by that name.</p>
          ) : (
            matches.map((person) => (
              <button
                key={person.id}
                type="button"
                // Keeps the box focused so the click lands before the list closes.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(person.id)}
                role="option"
                aria-selected={false}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-secondary-900 hover:bg-secondary-50 transition-colors"
              >
                <span className="flex-1 truncate">{person.displayName}</span>
                {person.isAdmin ? (
                  <span className="text-xs text-secondary-500 shrink-0">Admin</span>
                ) : person.isMentor ? (
                  <span className="text-xs text-secondary-500 shrink-0">Mentor</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Who may check off a Quality Control process, and whether every part ends with one.
 * Admins can always check one off; anyone else has to be a shop manager here.
 */
function QualityControlSettings() {
  const [state, setState] = useState<QualityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [pickingProcess, setPickingProcess] = useState(false);
  const refreshAuth = useRefreshAuthUser();

  const load = useCallback(async () => {
    const res = await api.admin.quality.$get();
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    setState((await res.json()) as QualityState);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once
  useEffect(() => {
    void load();
  }, []);

  async function setManager(userId: string, manager: boolean) {
    setBusy(true);
    // Show the change at once; the reload behind it confirms.
    setState((prev) =>
      prev
        ? {
            ...prev,
            people: prev.people.map((p) => (p.id === userId ? { ...p, isManager: manager } : p)),
          }
        : prev,
    );
    const res = await api.admin.quality.managers[":userId"].$put({
      param: { userId },
      json: { manager },
    });
    setBanner(res.ok ? null : await getErrorMessage(res as unknown as Response));
    await load();
    // Whoever changed is told by /me whether they may sign a step off.
    refreshAuth();
    setBusy(false);
  }

  async function saveCheck(next: {
    requireQualityCheck?: boolean;
    qualityProcessId?: number | null;
  }) {
    setBusy(true);
    const res = await api.admin.quality.settings.$put({ json: next });
    setBanner(res.ok ? null : await getErrorMessage(res as unknown as Response));
    await load();
    // The shop floor reads the check from /me, so it has to hear about the change.
    refreshAuth();
    setBusy(false);
  }

  if (!state) return <p className="text-sm text-secondary-500">Loading…</p>;

  const steps = state.qualityProcesses;
  const checkOn = state.requireQualityCheck || pickingProcess;

  // The worker only saves "required" with a process, so turning it on without one just shows
  // the picker; picking a process saves both.
  async function toggleCheck(on: boolean) {
    if (on) {
      if (state?.qualityProcessId == null) {
        setPickingProcess(true);
        return;
      }
      await saveCheck({ requireQualityCheck: true });
      return;
    }
    setPickingProcess(false);
    if (state?.requireQualityCheck) await saveCheck({ requireQualityCheck: false });
  }

  async function pickProcess(id: number | null) {
    if (id === null) {
      await saveCheck({ requireQualityCheck: false, qualityProcessId: null });
      return;
    }
    await saveCheck({ qualityProcessId: id, requireQualityCheck: true });
    setPickingProcess(false);
  }
  const managers = state.people.filter((p) => p.isManager);

  return (
    <div className="space-y-6">
      {banner && <ErrorBanner message={banner} />}

      <div className="space-y-3">
        <h3 className={sectionHeading}>
          Shop Managers <span className="text-secondary-500 font-normal">({managers.length})</span>
        </h3>
        <p className="text-xs text-secondary-500">
          Shop managers and admins are the only people who can mark a Quality Control process
          complete. A kiosk PIN sign-in doesn't carry anyone's admin role, so add your admins here
          too if they check parts off at a kiosk.
        </p>
        {!state.peopleLoaded && (
          <p className="text-xs text-amber-700">
            The team's member list didn't load, so only the current shop managers are shown.
          </p>
        )}
        {managers.length > 0 && (
          <div className="space-y-1.5 max-w-sm">
            {managers.map((person) => (
              <div
                key={person.id}
                className="flex items-center gap-2 bg-inset border border-secondary-200 rounded-lg px-3.5 py-2 text-sm text-secondary-900"
              >
                <span className="flex-1 truncate">{person.displayName}</span>
                {person.isAdmin ? (
                  <span className="text-xs text-secondary-500 shrink-0">Admin</span>
                ) : person.isMentor ? (
                  <span className="text-xs text-secondary-500 shrink-0">Mentor</span>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setManager(person.id, false)}
                  aria-label={`Remove ${person.displayName}`}
                  title="No longer a shop manager"
                  className="text-secondary-500 hover:text-red-600 px-1 transition-colors disabled:opacity-50"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {state.peopleLoaded && (
          <PersonPicker
            people={state.people.filter((p) => !p.isManager)}
            disabled={busy}
            onPick={(id) => setManager(id, true)}
          />
        )}
      </div>

      <div className="space-y-3">
        <h3 className={sectionHeading}>Require Quality Control</h3>
        {steps.length === 0 ? (
          <p className="text-xs text-secondary-500">
            Add a process with the type Quality Control under Shop Settings first.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-secondary-900">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={checkOn}
                  disabled={busy}
                  onChange={(e) => toggleCheck(e.target.checked)}
                  className="accent-primary-500 w-4 h-4"
                />
                Require quality control
              </label>
              <InfoTip label="What requiring quality control does">
                The process you pick goes at the end of every part's processes from now on, so
                nothing finishes without a shop manager signing it off. Parts already being made
                keep the steps they have.
              </InfoTip>
            </div>
            {checkOn && (
              <select
                aria-label="Process to require"
                value={state.qualityProcessId ?? ""}
                disabled={busy}
                onChange={(e) => pickProcess(Number(e.target.value) || null)}
                className={`${inputClass} max-w-sm`}
              >
                <option value="">— Pick a process to require —</option>
                {steps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>

      <div className="space-y-3">
        <h3 className={sectionHeading}>Quality Reports</h3>
        <QualityReports />
      </div>
    </div>
  );
}

function KioskModeSettings() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3 max-w-xl">
      <p className="text-sm text-secondary-500">
        Kiosk mode makes this device a shared station where members sign in with their 3-digit PIN.
        It signs you out and takes the device through kiosk activation in ID. Name the kiosk after a
        machine (“Mill”) to open that machine's queue.
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
  id,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** Opens the section, and scrolls to it, when the address ends in `#<id>`. */
  id?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const { hash } = useLocation();
  const linked = id !== undefined && hash === `#${id}`;
  const [open, setOpen] = useState(defaultOpen || linked);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!linked) return;
    setOpen(true);
    ref.current?.scrollIntoView({ block: "start" });
  }, [linked]);
  return (
    <section ref={ref} id={id} className="bg-surface border border-secondary-200 rounded-xl">
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

/** What removing one will do, from how many parts use it (unknown until the counts load). */
function removeQuestion(name: string, use: Usage | undefined, loaded: boolean) {
  if (!loaded) {
    return `Remove ${name}? If parts use it, it will be hidden from new parts and existing parts keep it; if not, it will be deleted.`;
  }
  if (!use?.inUse) return `Nothing uses ${name}, so it will be deleted.`;
  if (use.parts === 0) {
    return `${name} is in the shop's records: it will be hidden from new parts, and what already uses it keeps it.`;
  }
  return `Used by ${use.parts} ${use.parts === 1 ? "part" : "parts"}: it will be hidden from new parts, and existing parts keep it.`;
}

/** A list's heading, its count, and the admins' switch for the removed ones. */
function ListHeading({
  title,
  count,
  removed,
  showRemoved,
  setShowRemoved,
}: {
  title: string;
  count: number;
  /** How many were removed; the switch shows only when there are some. */
  removed: number;
  showRemoved: boolean;
  setShowRemoved: (show: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h3 className="font-sans text-sm font-bold uppercase tracking-wider text-secondary-500">
        {title} <span className="text-secondary-400 font-normal">({count})</span>
      </h3>
      {removed > 0 && (
        <span className="flex items-center gap-2 text-xs text-secondary-500">
          <Switch
            checked={showRemoved}
            onChange={setShowRemoved}
            label={`Show removed ${title.toLowerCase()}`}
          />
          Show removed ({removed})
        </span>
      )}
    </div>
  );
}

/**
 * One subsystem or process. Admins remove it, after a question in the row saying what will
 * happen, or restore it once removed. `blocked` says why it can't be removed now.
 */
function ItemRow({
  name,
  archived,
  isAdmin,
  question,
  blocked,
  onRemove,
  onRestore,
  children,
}: {
  name: string;
  archived: boolean;
  isAdmin: boolean;
  question: string;
  blocked?: string | null;
  onRemove: () => void;
  onRestore: () => void;
  /** Its own controls, shown while it isn't removed. */
  children?: React.ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 bg-page border border-secondary-200 rounded-lg px-3.5 py-2 text-sm text-secondary-900">
      <span
        className={`flex-1 min-w-0 truncate ${archived ? "text-secondary-500" : ""}`}
        title={name}
      >
        {name}
      </span>
      {archived ? <Badge>Removed</Badge> : children}
      {isAdmin &&
        (archived ? (
          <Button variant="secondary" size="sm" onClick={onRestore}>
            Restore
          </Button>
        ) : (
          !asking && (
            <Button variant="secondary" size="sm" onClick={() => setAsking(true)}>
              Remove
            </Button>
          )
        ))}
      {asking &&
        (blocked ? (
          <div className="basis-full space-y-2 rounded-lg border border-secondary-200 bg-inset p-3">
            <p className="text-sm text-secondary-700">{blocked}</p>
            <Button variant="secondary" size="sm" onClick={() => setAsking(false)}>
              OK
            </Button>
          </div>
        ) : (
          <ConfirmQuestion
            question={question}
            confirmLabel="Remove"
            size="sm"
            onConfirm={() => {
              setAsking(false);
              onRemove();
            }}
            onKeep={() => setAsking(false)}
          />
        ))}
    </div>
  );
}

function NameList({
  title,
  items,
  draft,
  setDraft,
  onAdd,
  placeholder,
  isAdmin,
  usage,
  onRemove,
  onRestore,
}: {
  title: string;
  items: { id: number; name: string; archivedAt: number | null }[];
  draft: string;
  setDraft: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
  isAdmin: boolean;
  usage: Record<string, Usage> | undefined;
  onRemove: (id: number) => void;
  onRestore: (id: number) => void;
}) {
  const [showRemoved, setShowRemoved] = useState(false);
  const active = items.filter((item) => item.archivedAt === null);
  const removed = items.length - active.length;
  const shown = showRemoved && isAdmin ? items : active;
  return (
    <div className="space-y-3">
      <ListHeading
        title={title}
        count={active.length}
        removed={isAdmin ? removed : 0}
        showRemoved={showRemoved}
        setShowRemoved={setShowRemoved}
      />
      {isAdmin && (
        <div className="flex gap-2">
          <TextField
            kind="label"
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAdd();
            }}
            className="flex-1 min-w-0"
          />
          <Button onClick={onAdd}>Add</Button>
        </div>
      )}
      <div className="space-y-1.5">
        {shown.length === 0 && <p className="text-secondary-400 text-sm">None yet.</p>}
        {shown.map((item) => (
          <ItemRow
            key={item.id}
            name={item.name}
            archived={item.archivedAt !== null}
            isAdmin={isAdmin}
            question={removeQuestion(item.name, usage?.[item.id], usage !== undefined)}
            onRemove={() => onRemove(item.id)}
            onRestore={() => onRestore(item.id)}
          />
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
  isAdmin,
  usage,
  requiredCheck,
  onRemove,
  onRestore,
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
  isAdmin: boolean;
  usage: Record<string, Usage> | undefined;
  /** The team's required quality check, which can't be removed while it's required. */
  requiredCheck: number | null;
  onRemove: (id: number) => void;
  onRestore: (id: number) => void;
}) {
  const [showRemoved, setShowRemoved] = useState(false);
  const active = processes.filter((p) => p.archivedAt === null);
  const removed = processes.length - active.length;
  const shown = showRemoved && isAdmin ? processes : active;
  return (
    <div className="space-y-3">
      <ListHeading
        title="Processes"
        count={active.length}
        removed={isAdmin ? removed : 0}
        showRemoved={showRemoved}
        setShowRemoved={setShowRemoved}
      />
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <TextField
            kind="process"
            placeholder="New process (e.g. Welding)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAdd();
            }}
            className="flex-1 min-w-40"
          />
          <div className="flex items-center gap-2">
            <ProcessTypeSelect value={draftType} onChange={setDraftType} label="New process type" />
            <PartInfoToggle checked={draftNeedsInfo} onChange={setDraftNeedsInfo} />
            <Button onClick={onAdd}>Add</Button>
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        {shown.length === 0 && <p className="text-secondary-400 text-sm">None yet.</p>}
        {shown.map((p) => (
          <ItemRow
            key={p.id}
            name={p.name}
            archived={p.archivedAt !== null}
            isAdmin={isAdmin}
            question={removeQuestion(p.name, usage?.[p.id], usage !== undefined)}
            blocked={
              p.id === requiredCheck
                ? `${p.name} is the team's required quality check. Turn off "Require quality control" in Quality Control first.`
                : null
            }
            onRemove={() => onRemove(p.id)}
            onRestore={() => onRestore(p.id)}
          >
            <PartInfoToggle
              checked={!!p.requiresPartInfo}
              onChange={(requiresPartInfo) => onUpdate(p.id, { requiresPartInfo })}
            />
            <ProcessTypeSelect
              value={p.type}
              onChange={(type) => onUpdate(p.id, { type })}
              label={`Type for ${p.name}`}
            />
          </ItemRow>
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
      refreshOnshapeStatus();
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
          <TextField
            kind="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") parseUrl();
            }}
            placeholder="https://cad.onshape.com/documents/[...]/e/[...]"
            className="flex-1"
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
        <TextField
          typeable
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
          placeholder="e.g. abc123def456"
        />
      </Field>

      <Field
        label="Main Assembly ID"
        hint="Optional: fills in how many of each part a release needs"
      >
        <TextField
          typeable
          value={mainAssemblyId}
          onChange={(e) => setMainAssemblyId(e.target.value)}
          placeholder="e.g. xyz789"
        />
      </Field>

      <Field label="Company ID">
        <TextField
          typeable
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          placeholder="The Onshape company (or classroom) that owns the document"
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

function DailySummaryButtons({ chat }: { chat: string }) {
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
      const res = await api.admin.chat["daily-summary"].$post({
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
            Post the {SUMMARY_KINDS[asking].label} ({SUMMARY_KINDS[asking].blurb}) to the {chat}{" "}
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

function ChannelSettings() {
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
      const res = await (api as any).admin.chat.config.$get();
      if (!res.ok) {
        setBanner(await getErrorMessage(res as unknown as Response));
        return;
      }
      const config = (await res.json()) as {
        releaseChannelId: string;
        summaryChannelId: string;
      };
      setChannelId(config.releaseChannelId || "");
      setSummaryChannelId(config.summaryChannelId || "");
      setBanner(null);
      setLoaded(true);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Failed to load the channels");
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
      const res = await (api as any).admin.chat.config.$post({
        json: {
          releaseChannelId: channelId.trim(),
          summaryChannelId: summaryChannelId.trim(),
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
      {saved && <SuccessBanner message="Channels saved." />}

      <div className="space-y-1">
        <label htmlFor="channel-id" className="block text-sm font-medium text-secondary-700">
          Release notification channel *
        </label>
        <ChannelPicker
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
        <ChannelPicker
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
