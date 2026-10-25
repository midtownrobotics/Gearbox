import { pageTeamNumber } from "@g3/site-config";
import {
  Button,
  Card,
  Chip,
  Dialog,
  ErrorBanner,
  Loading,
  Page as SharedPage,
  TextField,
  chatName,
  inputClass,
  tones,
  useQuestions,
  useTeamChat,
  useTeamNames,
} from "@g3/ui";
import { describeServiceIssue } from "@g3/worker-scouting/service-issues";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  CheckCircle2,
  GripVertical,
  Info,
  Maximize2,
  Megaphone,
  Minimize2,
  Minus,
  Pencil,
  Plus,
  Save,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FormFieldMap } from "./FormFieldMap";
import {
  type IssueChoice,
  IssueTypePicker,
  emptyIssueChoice,
  issueTypesToSend,
} from "./IssueTypePicker";
import { MatchCoverage } from "./MatchCoverage";
import { Operations } from "./Operations";
import { PitCoverage } from "./PitCoverage";
import { TeamLookupInput } from "./TeamLookupInput";
import { api } from "./api";
import { draftStatusText } from "./draft-status";
import { clearInputError, showTeamNumberError } from "./input-validation";
import {
  type DraftSaveResult,
  type MatchDraft,
  dataUrlToBlob,
  deleteDraft,
  hasContent,
  listDrafts,
  loadDraft,
  saveDraft,
} from "./match-drafts";
import { DoneScreen, MoveOnBar, ParkedDrafts, clock as clockText, timeOf } from "./match-handover";

export type FieldType =
  | "shortText"
  | "longText"
  | "mcq"
  | "slider"
  | "fieldMap"
  | "multiSelect"
  | "counter";
export type ScoutingField = {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  min: number;
  max: number;
  step: number;
};
export type ScoutingForm = {
  id: string;
  name: string;
  description: string;
  fields: ScoutingField[];
  isActive: boolean;
  kind: "scouting" | "pit";
};
type UserOption = { id: string; displayName: string; email: string; status: string };
type StrategyAdmin = { user_id: string; display_name: string; email: string };

const TYPES: { type: FieldType; label: string }[] = [
  { type: "shortText", label: "Text entry — short" },
  { type: "longText", label: "Text entry — long" },
  { type: "mcq", label: "Multiple choice" },
  { type: "slider", label: "Slider" },
  { type: "fieldMap", label: "Field map drawing" },
  { type: "multiSelect", label: "Multiple select" },
  { type: "counter", label: "Counter" },
];

const COUNTER_INTERVALS = [1, 5, 10, 20] as const;

/** A multiple choice question this few, this short choices is answered with bubbles: one tap. */
const MAX_BUBBLE_CHOICES = 6;
const MAX_BUBBLE_LENGTH = 20;
function answeredWithBubbles(field: ScoutingField) {
  return (
    field.options.length > 0 &&
    field.options.length <= MAX_BUBBLE_CHOICES &&
    field.options.every((option) => option.length <= MAX_BUBBLE_LENGTH)
  );
}

function FieldInput({
  field,
  value,
  setValue,
  canvasRef,
  canvasKey,
  onDrawingChange,
  onCommit,
  initialImage,
}: {
  field: ScoutingField;
  value: unknown;
  setValue: (value: unknown) => void;
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  canvasKey?: number;
  onDrawingChange?: (hasDrawing: boolean) => void;
  onCommit?: (canvas: HTMLCanvasElement) => void;
  initialImage?: string;
}) {
  const inputId = `field-${field.id}`;
  const [counterInterval, setCounterInterval] = useState<(typeof COUNTER_INTERVALS)[number]>(1);
  if (field.type === "fieldMap" && canvasRef)
    return (
      <div className="space-y-3">
        {value !== "no-minimal-movement" && (
          <FormFieldMap
            key={canvasKey}
            canvasRef={canvasRef}
            onDrawingChange={onDrawingChange}
            onCommit={onCommit}
            initialImage={initialImage}
          />
        )}
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={value === "no-minimal-movement"}
            onChange={(event) => setValue(event.target.checked ? "no-minimal-movement" : "")}
          />
          No/minimal movement
        </label>
      </div>
    );
  if (field.type === "counter") {
    const current = Number(value ?? 0);
    return (
      <div className="counter-control">
        <div className="counter-intervals" aria-label="Counter interval">
          {COUNTER_INTERVALS.map((interval) => (
            <button
              type="button"
              className={counterInterval === interval ? "active" : ""}
              key={interval}
              onClick={() => setCounterInterval(interval)}
              aria-pressed={counterInterval === interval}
            >
              ±{interval}
            </button>
          ))}
        </div>
        <div className="counter-input">
          <button
            type="button"
            aria-label={`Subtract ${counterInterval}`}
            onClick={() => setValue(Math.max(0, current - counterInterval))}
          >
            −{counterInterval}
          </button>
          <strong aria-live="polite">{current}</strong>
          <button
            type="button"
            aria-label={`Add ${counterInterval}`}
            onClick={() => setValue(current + counterInterval)}
          >
            +{counterInterval}
          </button>
        </div>
      </div>
    );
  }
  if (field.type === "slider")
    return (
      <div className="slider-control">
        <div className="slider-input">
          <input
            id={inputId}
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={Number(value ?? field.min)}
            onChange={(event) => setValue(Number(event.target.value))}
          />
          <output>{String(value ?? field.min)}</output>
        </div>
      </div>
    );
  if (field.type === "longText")
    return (
      <TextField
        multiline
        kind="observation"
        id={inputId}
        required={field.required}
        value={String(value ?? "")}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  if (field.type === "mcq" && answeredWithBubbles(field)) {
    const selected = String(value ?? "");
    return (
      <div
        className="choice-bubbles"
        role="radiogroup"
        aria-labelledby={`${inputId}-label`}
        aria-required={field.required || undefined}
      >
        {field.options.map((option) => (
          <label key={option} className={option === selected ? "selected" : ""}>
            <input
              type="radio"
              name={inputId}
              value={option}
              required={field.required}
              checked={option === selected}
              onChange={() => setValue(option)}
              // Tapping the chosen answer again clears it, and so does Space, which browsers
              // don't turn into a click on a radio that's already checked.
              onClick={() => {
                if (option === selected) setValue("");
              }}
              onKeyDown={(event) => {
                if (event.key !== " " || option !== selected) return;
                event.preventDefault();
                setValue("");
              }}
            />
            {option === selected && <Check size={17} aria-hidden="true" />}
            {option}
          </label>
        ))}
      </div>
    );
  }
  if (field.type === "mcq")
    return (
      <select
        className={inputClass}
        id={inputId}
        required={field.required}
        value={String(value ?? "")}
        onChange={(event) => setValue(event.target.value)}
      >
        <option value="">Select…</option>
        {field.options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  if (field.type === "multiSelect") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="multi-select-control">
        <div className="multi-select">
          {field.options.map((option) => (
            <label key={option}>
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={(event) =>
                  setValue(
                    event.target.checked
                      ? [...selected, option]
                      : selected.filter((item) => item !== option),
                  )
                }
              />{" "}
              {option}
            </label>
          ))}
        </div>
      </div>
    );
  }
  return (
    <TextField
      kind="answer"
      id={inputId}
      required={field.required}
      value={String(value ?? "")}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

/** How long the bar counts down before the form moves on, and what "more time" adds each time. */
const WARNING_SECONDS = 20;
const EXTENSION_SECONDS = 30;
const MAX_EXTENSIONS = 3;
/** Without a start time for the next match, how long the done screen waits before opening it. */
const DONE_OPENS_AFTER_MS = 60_000;

/** The match and team a match form is filled in for, and when that match moves on. */
type DraftTarget = { match: EventMatch; team: string; closesAt: number | null };
type SentReport = { matchKey: string; label: string; team: string; at: number; late: boolean };

function EntryForm({
  form,
  context,
  refreshContext,
  scheduleUnavailable,
  userId,
  pitTeam,
}: {
  form: ScoutingForm;
  context: EventContext | null;
  refreshContext: () => Promise<void>;
  scheduleUnavailable: boolean;
  userId: string;
  pitTeam?: string;
}) {
  if (form.kind !== "scouting")
    return (
      <EntryDraft
        form={form}
        userId={userId}
        target={null}
        initialTeam={pitTeam}
        refreshContext={refreshContext}
        scheduleUnavailable={scheduleUnavailable}
      />
    );
  return (
    <MatchEntry
      form={form}
      context={context}
      refreshContext={refreshContext}
      scheduleUnavailable={scheduleUnavailable}
      userId={userId}
    />
  );
}

/**
 * A match form through a match: it follows the match the worker gives this scout, but never pulls
 * a form with answers in it out from under them. Near the match's close a bar counts down, with
 * time to add; when it runs out, the answers stay on the device, offered above the next form to
 * send late. A sent report shows what went where until the next match starts.
 */
function MatchEntry({
  form,
  context,
  refreshContext,
  scheduleUnavailable,
  userId,
}: {
  form: ScoutingForm;
  context: EventContext | null;
  refreshContext: () => Promise<void>;
  scheduleUnavailable: boolean;
  userId: string;
}) {
  // Server time, kept off the device's own clock so changing it can't expire a draft.
  const clock = useMemo(
    () => ({ time: context?.serverNow ?? Date.now(), started: performance.now() }),
    [context?.serverNow],
  );
  const serverNow = useCallback(() => clock.time + performance.now() - clock.started, [clock]);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, []);
  const now = serverNow();
  const liveMatch = context?.currentMatch ?? null;
  const liveTeam = context?.assignedTeam ?? null;
  const liveClosesAt = context?.submissionClosesAt ?? null;
  const live = useMemo<DraftTarget | null>(
    () =>
      liveMatch && liveTeam ? { match: liveMatch, team: liveTeam, closesAt: liveClosesAt } : null,
    [liveMatch, liveTeam, liveClosesAt],
  );
  const [target, setTarget] = useState<DraftTarget | null>(live);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extensions, setExtensions] = useState(0);
  const [movedSeenAt, setMovedSeenAt] = useState<number | null>(null);
  const [sent, setSent] = useState<SentReport | null>(null);
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [switchedTo, setSwitchedTo] = useState<string | null>(null);
  const [parked, setParked] = useState<MatchDraft[]>([]);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const refreshParked = useCallback(
    () => setParked(listDrafts(userId, form.id)),
    [userId, form.id],
  );

  // Follow the worker's match and team. A form with answers waits for the countdown below.
  useEffect(() => {
    setTarget((current) => {
      if (!live) return current && dirty ? current : null;
      if (!current) return live;
      if (current.match.key !== live.match.key) return dirty ? current : live;
      if (current.team !== live.team) return live;
      return current.closesAt === live.closesAt ? current : { ...current, closesAt: live.closesAt };
    });
  }, [live, dirty]);

  const targetKey = target ? `${target.match.key}:${target.team}` : "";
  const targetName = target ? `${target.match.label} · Team ${target.team}` : null;
  const lastTargetKey = useRef("");
  useEffect(() => {
    setExtensions(0);
    setMovedSeenAt(null);
    refreshParked();
    // Said only when the form changes match under the scout, not when it first loads.
    const previous = lastTargetKey.current;
    lastTargetKey.current = targetKey;
    if (previous && targetKey && targetName) setSwitchedTo(targetName);
  }, [targetKey, targetName, refreshParked]);
  useEffect(() => {
    if (!switchedTo) return;
    const clear = window.setTimeout(() => setSwitchedTo(null), 8_000);
    return () => window.clearTimeout(clear);
  }, [switchedTo]);

  // The worker has moved past the match this form is for.
  const serverMoved = target !== null && (!live || live.match.key !== target.match.key);
  useEffect(() => {
    if (serverMoved && dirty) setMovedSeenAt((seen) => seen ?? serverNow());
  }, [serverMoved, dirty, serverNow]);

  // When the form moves on: the match's close, else (a manual schedule) a short count from the
  // moment the lead moved on, plus whatever time the scout added.
  const deadline =
    target?.closesAt ?? (movedSeenAt === null ? null : movedSeenAt + WARNING_SECONDS * 1000);
  const moveAt = deadline === null ? null : deadline + extensions * EXTENSION_SECONDS * 1000;
  const lateWindowSeconds = context?.lateWindowSeconds ?? 600;
  const maxExtensions = Math.min(MAX_EXTENSIONS, Math.floor(lateWindowSeconds / EXTENSION_SECONDS));
  const nextMatch = serverMoved ? (live?.match ?? null) : (context?.upcomingMatch ?? null);
  const nextStarted = nextMatch?.scheduledAt != null && now >= nextMatch.scheduledAt;
  const showBar =
    target !== null && dirty && !sent && moveAt !== null && now >= moveAt - WARNING_SECONDS * 1000;
  const moveDue = target !== null && dirty && moveAt !== null && now >= moveAt;
  useEffect(() => {
    if (moveDue) void refreshContext().catch(() => {});
  }, [moveDue, refreshContext]);
  useEffect(() => {
    if (!moveDue || !serverMoved) return;
    // Its answers are already saved on the device, and offered above the next form.
    setDirty(false);
    setTarget(live);
  }, [moveDue, serverMoved, live]);

  // Once a report is in: the done screen until the next match starts, or a minute without a time.
  const nextReady =
    sent !== null &&
    live !== null &&
    live.match.key !== sent.matchKey &&
    !(context?.submittedFormIds?.includes(form.id) ?? context?.hasSubmittedCurrentMatch);
  useEffect(() => {
    setReadyAt((at) => (nextReady ? (at ?? serverNow()) : null));
  }, [nextReady, serverNow]);
  const nextStartsAt = nextReady ? (live?.match.scheduledAt ?? null) : null;
  const opensAt =
    readyAt === null
      ? null
      : nextStartsAt !== null && nextStartsAt > readyAt
        ? nextStartsAt
        : readyAt + DONE_OPENS_AFTER_MS;
  useEffect(() => {
    if (opensAt !== null && now >= opensAt) setSent(null);
  }, [opensAt, now]);
  const onSubmitted = useCallback((report: SentReport) => {
    setSent(report);
    setDirty(false);
  }, []);

  useEffect(() => {
    if (!message) return;
    const clear = window.setTimeout(() => setMessage(null), 10_000);
    return () => window.clearTimeout(clear);
  }, [message]);

  async function sendParked(draft: MatchDraft) {
    const payload = new FormData();
    payload.set("teamName", draft.teamName);
    payload.set("matchKey", draft.matchKey);
    payload.set("answers", JSON.stringify(draft.answers));
    try {
      for (const field of form.fields.filter((item) => item.type === "fieldMap")) {
        const drawing = draft.drawings[field.id];
        if (drawing)
          payload.set(`drawing:${field.id}`, await dataUrlToBlob(drawing), `${field.id}.jpg`);
      }
      const result = await api<{ late?: boolean }>(`/scouting-forms/${form.id}/submissions`, {
        method: "POST",
        body: payload,
      });
      deleteDraft(userId, form.id, draft.matchKey);
      refreshParked();
      setMessage({
        type: "success",
        text: `${draft.matchLabel} report sent${result?.late ? ", marked late" : ""}.`,
      });
      void refreshContext().catch(() => {});
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Could not send the report.";
    }
  }

  const showDone =
    sent !== null ||
    Boolean(context?.submittedFormIds?.includes(form.id) ?? context?.hasSubmittedCurrentMatch);
  const doneLabel = sent?.label ?? liveMatch?.label ?? "Match";
  const upcoming = context?.upcomingMatch ?? null;
  let banner: ReactNode = null;
  if (scheduleUnavailable) {
    banner = (
      <span role="status">
        Can't reach the match schedule. Your answers are kept; sending waits until it's back.
      </span>
    );
  } else if (target && context?.scheduleMode === "manual") {
    banner = <span>Manual schedule: this form moves on when the lead changes the match.</span>;
  } else if (target && target.closesAt === null) {
    banner = (
      <span>
        Send within {clockText(context?.submissionWindowSeconds ?? 120)} after the match ends.
      </span>
    );
  } else if (target && target.closesAt !== null && now < target.closesAt) {
    banner = (
      <span>
        Send by{" "}
        <strong>
          {new Date(target.closesAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })}
        </strong>
        .{" "}
        <span role="timer" aria-live="off">
          {clockText((target.closesAt - now) / 1000)} left.
        </span>
      </span>
    );
  } else if (target) {
    banner = <span>Time’s up for {target.match.label}. Send it now: it’s marked late.</span>;
  }
  return (
    <>
      <ParkedDrafts
        drafts={parked.filter((draft) => draft.matchKey !== target?.match.key)}
        onSend={sendParked}
        onDiscard={(draft) => {
          deleteDraft(userId, form.id, draft.matchKey);
          refreshParked();
        }}
      />
      {showDone ? (
        <DoneScreen
          sentLabel={doneLabel}
          detail={
            sent
              ? `${sent.late ? "Sent late" : "Sent"} ${timeOf(sent.at)} · Team ${sent.team}`
              : null
          }
          next={
            nextReady && live
              ? { label: live.match.label, team: live.team, startsAt: live.match.scheduledAt }
              : null
          }
          waiting={
            context?.submittedFormIds?.includes(form.id) && !context.hasSubmittedCurrentMatch
              ? "This form is submitted. Choose another active match form above to finish this match."
              : upcoming
                ? `${upcoming.label} opens once ${doneLabel} is scored.`
                : "No more matches on the schedule for now."
          }
          now={now}
          opensAt={opensAt}
          onStart={() => setSent(null)}
        />
      ) : (
        <>
          {switchedTo && (
            <p
              className={`m-0 rounded-lg border px-4 py-2 text-sm font-semibold ${tones.info}`}
              role="status"
            >
              Now scouting {switchedTo}
            </p>
          )}
          <EntryDraft
            key={`${form.id}:${targetKey}`}
            form={form}
            userId={userId}
            target={target}
            banner={banner}
            formRef={formRef}
            scheduleUnavailable={scheduleUnavailable}
            refreshContext={refreshContext}
            onSubmitted={onSubmitted}
            onDirtyChange={setDirty}
            onSavingChange={setSaving}
          />
        </>
      )}
      {showBar && target && (
        <MoveOnBar
          matchLabel={target.match.label}
          nextLabel={nextMatch?.label ?? null}
          secondsLeft={moveAt === null ? 0 : (moveAt - now) / 1000}
          extendSeconds={EXTENSION_SECONDS}
          canExtend={extensions < maxExtensions && !nextStarted}
          sending={saving}
          onSend={() => formRef.current?.requestSubmit()}
          onExtend={() => setExtensions((count) => count + 1)}
        />
      )}
      {message && (
        <div className={`status-toast ${message.type}`} role="status" aria-live="polite">
          {message.type === "success" ? <CheckCircle2 size={21} /> : <AlertCircle size={21} />}
          <div>
            <strong>{message.type === "success" ? "Success" : "Couldn’t send"}</strong>
            <span>{message.text}</span>
          </div>
          <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss notification">
            <X size={17} />
          </button>
        </div>
      )}
    </>
  );
}

function EntryDraft({
  form,
  initialTeam,
  userId,
  target,
  banner,
  formRef,
  scheduleUnavailable,
  refreshContext,
  onSubmitted,
  onDirtyChange,
  onSavingChange,
}: {
  form: ScoutingForm;
  initialTeam?: string;
  userId: string;
  /** A match form's match and team; null for a pit form, or a match form with no match yet. */
  target: DraftTarget | null;
  banner?: ReactNode;
  formRef?: RefObject<HTMLFormElement | null>;
  scheduleUnavailable: boolean;
  refreshContext: () => Promise<void>;
  onSubmitted?: (report: SentReport) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const isMatch = form.kind === "scouting";
  const match = target?.match ?? null;
  // A draft this device kept for this match and team picks up where it left off.
  const [restored] = useState(() => {
    const draft = isMatch
      ? loadDraft(userId, form.id, target?.match.key ?? "")
      : initialTeam
        ? loadDraft(userId, form.id, `__pit__:${initialTeam}`)
        : listDrafts(userId, form.id).find((item) => item.matchKey.startsWith("__pit__"));
    return draft && (!isMatch || draft.teamName === target?.team) && hasContent(draft)
      ? draft
      : null;
  });
  const [teamName, setTeamName] = useState(
    isMatch ? (target?.team ?? "") : (initialTeam ?? restored?.teamName ?? ""),
  );
  const [answers, setAnswers] = useState<Record<string, unknown>>(restored?.answers ?? {});
  const [initialDrawings, setInitialDrawings] = useState(restored?.drawings ?? {});
  const [hasDrawings, setHasDrawings] = useState(
    Boolean(restored && Object.keys(restored.drawings).length),
  );
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const [saving, setSaving] = useState(false);
  const [localSave, setLocalSave] = useState<DraftSaveResult | "saving">(
    restored?.missingDrawingFields?.length ? "partial" : restored ? "saved" : "empty",
  );
  const [submissionState, setSubmissionState] = useState<"idle" | "failed" | "submitted">("idle");
  const [canvasKey, setCanvasKey] = useState(0);
  const canvases = useRef<Record<string, HTMLCanvasElement | null>>({});
  const canvasAdapters = useRef<Record<string, RefObject<HTMLCanvasElement | null>>>({});
  const drawnFields = useRef(new Set<string>());
  const drawings = useRef<Record<string, string>>({ ...(restored?.drawings ?? {}) });
  const missingDrawingFields = useRef(new Set(restored?.missingDrawingFields ?? []));
  // Field maps with a saved drawing on its way back: their first "no drawing" is the blank field
  // loading, not the scout clearing it.
  const restoring = useRef(new Set(Object.keys(restored?.drawings ?? {})));
  const answersRef = useRef(answers);
  const pendingSave = useRef(false);
  const mounted = useRef(true);
  const blocked = isMatch && (!match || !teamName);
  const dirty = isMatch && (hasDrawings || hasContent({ answers, drawings: {} }));

  const persist = useCallback(() => {
    pendingSave.current = false;
    if (isMatch && !target) return;
    const result = saveDraft(userId, {
      formId: form.id,
      matchKey: target?.match.key ?? `__pit__:${teamName}`,
      matchLabel: target?.match.label ?? "Pit scouting",
      teamName: target?.team ?? teamName,
      answers: answersRef.current,
      drawings: { ...drawings.current },
      missingDrawingFields: [...missingDrawingFields.current],
      savedAt: Date.now(),
    });
    if (mounted.current) setLocalSave(result);
  }, [isMatch, target, userId, form.id, teamName]);
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);
  useEffect(() => {
    answersRef.current = answers;
    pendingSave.current = true;
    const timer = window.setTimeout(persist, 300);
    return () => window.clearTimeout(timer);
  }, [answers, persist]);
  useEffect(() => {
    // Leaving the page or the app saves what's typed at once.
    const flush = () => {
      if (pendingSave.current) persistRef.current();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    mounted.current = true;
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  function drawingChanged(fieldId: string, hasDrawing: boolean) {
    if (hasDrawing) {
      setSubmissionState("idle");
      restoring.current.delete(fieldId);
      drawnFields.current.add(fieldId);
      return;
    }
    if (restoring.current.has(fieldId)) return;
    drawnFields.current.delete(fieldId);
    if (!(fieldId in drawings.current)) return;
    setSubmissionState("idle");
    delete drawings.current[fieldId];
    setHasDrawings(Object.keys(drawings.current).length > 0);
    persist();
  }
  function drawingCommitted(fieldId: string, canvas: HTMLCanvasElement) {
    if (!drawnFields.current.has(fieldId)) return;
    try {
      drawings.current[fieldId] = canvas.toDataURL("image/jpeg", 0.85);
    } catch {
      missingDrawingFields.current.add(fieldId);
      setLocalSave("failed");
      return;
    }
    missingDrawingFields.current.delete(fieldId);
    setHasDrawings(true);
    persist();
  }

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    if (saving || blocked || (isMatch && scheduleUnavailable)) return;
    persist();
    setSubmissionState("idle");
    setSaving(true);
    setMessage("");
    try {
      const payload = new FormData();
      payload.set("teamName", teamName);
      if (isMatch) payload.set("matchKey", match?.key ?? "");
      payload.set("answers", JSON.stringify(answers));
      for (const field of form.fields.filter((item) => item.type === "fieldMap")) {
        if (!drawnFields.current.has(field.id)) continue;
        const canvas = canvases.current[field.id];
        if (canvas) {
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/png"),
          );
          if (blob) payload.set(`drawing:${field.id}`, blob, `${field.id}.png`);
        }
      }
      const result = await api<{ late?: boolean }>(`/scouting-forms/${form.id}/submissions`, {
        method: "POST",
        body: payload,
      });
      deleteDraft(userId, form.id, target?.match.key ?? `__pit__:${teamName}`);
      if (!mounted.current) return;
      setSubmissionState("submitted");
      drawings.current = {};
      missingDrawingFields.current.clear();
      answersRef.current = {};
      drawnFields.current.clear();
      setHasDrawings(false);
      setInitialDrawings({});
      setAnswers({});
      setCanvasKey((value) => value + 1);
      if (isMatch && target) {
        onSubmitted?.({
          matchKey: target.match.key,
          label: target.match.label,
          team: target.team,
          at: Date.now(),
          late: Boolean(result?.late),
        });
      } else {
        setMessageType("success");
        setMessage("Report submitted.");
      }
      await refreshContext().catch(() => {});
    } catch (error) {
      if (!mounted.current) return;
      setSubmissionState("failed");
      setMessageType("error");
      setMessage(error instanceof Error ? error.message : "Could not submit report.");
      if (isMatch) void refreshContext().catch(() => {});
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  function canvasAdapter(fieldId: string) {
    const existing = canvasAdapters.current[fieldId];
    if (existing) return existing;
    const adapter: RefObject<HTMLCanvasElement | null> = {
      get current() {
        return canvases.current[fieldId] ?? null;
      },
      set current(value: HTMLCanvasElement | null) {
        canvases.current[fieldId] = value;
      },
    };
    canvasAdapters.current[fieldId] = adapter;
    return adapter;
  }
  return (
    <form id={`entry-${form.id}`} className="scouting-entry" onSubmit={submit} ref={formRef}>
      <div className="scouting-form-title">
        <div className="scouting-form-heading-row">
          <h2>{form.name}</h2>
          {isMatch && (
            <div className="scouting-match-summary">
              <strong className="scouting-match-number">
                Match Number:
                <span>{match?.matchNumber ?? "--"}</span>
              </strong>
              {match ? (
                <div className="scouting-match-teams">
                  <span className="red-alliance">Red: {match.redTeams.join(", ")}</span>
                  <span className="blue-alliance">Blue: {match.blueTeams.join(", ")}</span>
                </div>
              ) : (
                <span>Teams unavailable</span>
              )}
            </div>
          )}
        </div>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={`text-sm ${submissionState === "submitted" ? "text-green-700" : localSave === "failed" || localSave === "partial" || submissionState === "failed" ? "text-amber-700" : "text-secondary-500"}`}
      >
        {draftStatusText(localSave, submissionState, saving)}
      </p>
      {isMatch && banner && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {banner}
          {restored && <span className="block">Your saved answers are back.</span>}
        </div>
      )}
      <fieldset
        className="m-0 grid min-w-0 gap-[22px] border-0 p-0 disabled:pointer-events-none"
        disabled={saving || blocked}
      >
        <label className="team-entry" htmlFor={`team-${form.id}`}>
          <span>
            Team number <b>*</b>
          </span>
          <TeamLookupInput
            value={teamName}
            onChange={(value) => {
              setSubmissionState("idle");
              setLocalSave("saving");
              setTeamName(value);
            }}
            size="lg"
            inputMode="numeric"
            readOnly={isMatch}
          />
        </label>
        <div className="scouting-questions">
          {form.fields.map((field) => {
            const mapRef = field.type === "fieldMap" ? canvasAdapter(field.id) : undefined;
            return (
              <div
                className={`scouting-question ${field.type === "fieldMap" ? "wide" : ""}`}
                key={field.id}
              >
                <label htmlFor={`field-${field.id}`} id={`field-${field.id}-label`}>
                  {field.label}
                  {field.required && <b> *</b>}
                </label>
                <FieldInput
                  field={field}
                  value={answers[field.id]}
                  setValue={(value) => {
                    if (field.type === "fieldMap") {
                      delete drawings.current[field.id];
                      drawnFields.current.delete(field.id);
                      restoring.current.delete(field.id);
                      setInitialDrawings((current) => {
                        const next = { ...current };
                        delete next[field.id];
                        return next;
                      });
                      setHasDrawings(Object.keys(drawings.current).length > 0);
                    }
                    answersRef.current = { ...answersRef.current, [field.id]: value };
                    pendingSave.current = true;
                    setSubmissionState("idle");
                    setLocalSave("saving");
                    setAnswers(answersRef.current);
                  }}
                  canvasRef={mapRef}
                  canvasKey={canvasKey}
                  initialImage={initialDrawings[field.id]}
                  onDrawingChange={(hasDrawing) => drawingChanged(field.id, hasDrawing)}
                  onCommit={(canvas) => drawingCommitted(field.id, canvas)}
                />
              </div>
            );
          })}
        </div>
      </fieldset>
      <Button
        variant="primary"
        type="submit"
        disabled={saving || blocked || (isMatch && scheduleUnavailable)}
      >
        <Check size={17} />{" "}
        {saving
          ? "Submitting…"
          : isMatch && scheduleUnavailable
            ? "Waiting for schedule"
            : isMatch && !teamName
              ? "Waiting for team"
              : "Submit report"}
      </Button>
      {message && (
        <div className={`status-toast ${messageType}`} role="status" aria-live="polite">
          {messageType === "success" ? <CheckCircle2 size={21} /> : <AlertCircle size={21} />}
          <div>
            <strong>{messageType === "success" ? "Success" : "Couldn’t submit"}</strong>
            <span>{message}</span>
          </div>
          <button type="button" onClick={() => setMessage("")} aria-label="Dismiss notification">
            <X size={17} />
          </button>
        </div>
      )}
    </form>
  );
}

function Editor({
  form,
  save,
  close,
}: { form: ScoutingForm; save: (form: ScoutingForm) => Promise<void>; close: () => void }) {
  const questions = useQuestions();
  const [draft, setDraft] = useState({
    ...form,
    fields: form.fields.map((field) => ({ ...field, required: false })),
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [draggedFieldId, setDraggedFieldId] = useState<string | null>(null);
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      form.fields
        .filter((field) => field.type === "mcq" || field.type === "multiSelect")
        .map((field) => [field.id, field.options.join(", ")]),
    ),
  );
  function patch(id: string, change: Partial<ScoutingField>) {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field) => (field.id === id ? { ...field, ...change } : field)),
    }));
  }
  function moveField(id: string, direction: -1 | 1) {
    setDraft((current) => {
      const from = current.fields.findIndex((field) => field.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.fields.length) return current;
      const fields = [...current.fields];
      const [moved] = fields.splice(from, 1);
      fields.splice(to, 0, moved);
      return { ...current, fields };
    });
  }
  return (
    <Card className="form-designer editor-card">
      <div className="form-designer-toolbar">
        <div>
          <h2>Edit {draft.name}</h2>
        </div>
        <Button variant="secondary" type="button" onClick={close}>
          <X size={16} /> Close
        </Button>
        <Button
          variant="primary"
          type="button"
          onClick={async () => {
            if (
              !(await questions.confirm(
                `Save these changes to ${draft.name}? Scouts will see the updated form immediately.`,
              ))
            )
              return;
            setSaving(true);
            setSaveError("");
            try {
              await save(draft);
            } catch (error) {
              setSaveError(error instanceof Error ? error.message : "Could not save this form.");
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
        >
          <Save size={16} /> {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
      {saveError && (
        <div className="editor-save-error" role="alert">
          <AlertCircle size={18} /> {saveError}
        </div>
      )}
      <div className="grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="grid gap-1 text-sm font-semibold">
          Form name
          <TextField
            kind="title"
            value={draft.name}
            maxLength={120}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(event) =>
              setDraft((current) => ({ ...current, isActive: event.target.checked }))
            }
          />
          Active for scouts
        </label>
      </div>
      <div className="designer-field-list">
        {draft.fields.map((field, index) => (
          <div
            className="designer-field"
            key={field.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (!draggedFieldId || draggedFieldId === field.id) return;
              setDraft((current) => {
                const from = current.fields.findIndex((item) => item.id === draggedFieldId);
                const to = current.fields.findIndex((item) => item.id === field.id);
                if (from < 0 || to < 0) return current;
                const fields = [...current.fields];
                const [moved] = fields.splice(from, 1);
                fields.splice(to, 0, moved);
                return { ...current, fields };
              });
              setDraggedFieldId(null);
            }}
          >
            <button
              type="button"
              className="field-drag-handle"
              draggable
              onDragStart={(event) => {
                setDraggedFieldId(field.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDraggedFieldId(null)}
              aria-label={`Drag question ${index + 1} to reorder`}
              title="Drag to reorder"
            >
              <GripVertical size={18} />
              <span>{index + 1}</span>
            </button>
            <TextField
              kind="question"
              value={field.label}
              onChange={(event) => patch(field.id, { label: event.target.value })}
              placeholder="Question"
            />
            <select
              className={inputClass}
              value={field.type}
              onChange={(event) => patch(field.id, { type: event.target.value as FieldType })}
            >
              {TYPES.map((item) => (
                <option key={item.type} value={item.type}>
                  {item.label}
                </option>
              ))}
            </select>
            {(field.type === "mcq" || field.type === "multiSelect") && (
              <TextField
                kind="choices"
                className="question-options-input"
                value={optionDrafts[field.id] ?? field.options.join(", ")}
                onChange={(event) => {
                  const value = event.target.value;
                  setOptionDrafts((current) => ({ ...current, [field.id]: value }));
                  patch(field.id, {
                    options: value.split(","),
                  });
                }}
                placeholder="Choices, comma separated"
              />
            )}
            {field.type === "slider" && (
              <div className="number-settings">
                <label>
                  <span>Minimum</span>
                  <input
                    type="number"
                    value={field.min}
                    onChange={(event) => patch(field.id, { min: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>Maximum</span>
                  <input
                    type="number"
                    value={field.max}
                    onChange={(event) => patch(field.id, { max: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>Step</span>
                  <input
                    type="number"
                    min="0.01"
                    value={field.step}
                    onChange={(event) => patch(field.id, { step: Number(event.target.value) })}
                  />
                </label>
              </div>
            )}
            <div className="field-actions">
              <button
                type="button"
                className="field-order-button"
                disabled={index === 0}
                onClick={() => moveField(field.id, -1)}
                aria-label={`Move question ${index + 1} up`}
                title="Move question up"
              >
                <ArrowUp size={18} />
              </button>
              <button
                type="button"
                className="field-order-button"
                disabled={index === draft.fields.length - 1}
                onClick={() => moveField(field.id, 1)}
                aria-label={`Move question ${index + 1} down`}
                title="Move question down"
              >
                <ArrowDown size={18} />
              </button>
              <Button
                variant="danger"
                type="button"
                className="delete-field-button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    fields: draft.fields.filter((item) => item.id !== field.id),
                  })
                }
                aria-label={`Delete question ${index + 1}`}
                title="Delete question"
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="add-field-button"
        onClick={() =>
          setDraft({
            ...draft,
            fields: [
              ...draft.fields,
              {
                id: crypto.randomUUID(),
                label: "New question",
                type: "shortText",
                required: false,
                options: [],
                min: 0,
                max: 10,
                step: 1,
              },
            ],
          })
        }
      >
        <Plus size={17} /> Add question
      </button>
    </Card>
  );
}

function AdminManager({ isG3IdAdmin }: { isG3IdAdmin: boolean }) {
  const questions = useQuestions();
  const [admins, setAdmins] = useState<StrategyAdmin[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [userId, setUserId] = useState("");
  const load = useCallback(async () => {
    const result = await api<{ admins: StrategyAdmin[]; users: UserOption[] }>("/strategy-admins");
    setAdmins(result.admins);
    setUsers(result.users);
  }, []);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);
  return (
    <details className="strategy-admins" open>
      <summary>
        <Shield size={17} /> Add Strategy Lead
      </summary>
      {isG3IdAdmin && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!(await questions.confirm("Make this person a Strategy lead?"))) return;
            await api("/strategy-admins", { method: "POST", body: JSON.stringify({ userId }) });
            setUserId("");
            await load();
          }}
        >
          <select
            className={inputClass}
            required
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          >
            <option value="">Select a member</option>
            {users
              .filter((user) => user.status === "active")
              .map((user) => {
                const isLead = admins.some((admin) => admin.user_id === user.id);
                return (
                  <option key={user.id} value={user.id} disabled={isLead}>
                    {isLead ? "🛡 Strategy lead · " : ""}
                    {user.displayName} ({user.email})
                  </option>
                );
              })}
          </select>
          <Button variant="primary" type="submit">
            <Plus size={16} /> Add Strategy Lead
          </Button>
        </form>
      )}
      <div className="strategy-admin-list">
        {admins.map((admin) => (
          <span key={admin.user_id}>
            {admin.display_name}
            <small>{admin.email}</small>
            {isG3IdAdmin && (
              <button
                type="button"
                onClick={async () => {
                  if (
                    !(await questions.confirm(`Remove ${admin.display_name} as a Strategy lead?`))
                  )
                    return;
                  await api(`/strategy-admins/${admin.user_id}`, { method: "DELETE" });
                  await load();
                }}
              >
                <X size={14} />
              </button>
            )}
          </span>
        ))}
      </div>
    </details>
  );
}

function AnnouncementManager() {
  const questions = useQuestions();
  const names = useTeamNames();
  const [message, setMessage] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("60");
  const [sent, setSent] = useState(false);
  return (
    <section className="announcement-admin">
      <h2>
        <Megaphone size={18} /> Announcement
      </h2>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            !(await questions.confirm(
              `Publish this announcement in ${names.appTitle("Scouting")}?`,
            ))
          )
            return;
          await api("/announcements", {
            method: "POST",
            body: JSON.stringify({ message, durationSeconds: Number(durationSeconds) }),
          });
          setMessage("");
          setSent(true);
        }}
      >
        <TextField
          kind="note"
          required
          maxLength={500}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            setSent(false);
          }}
          placeholder="Announcement"
        />
        <select
          className={inputClass}
          value={durationSeconds}
          onChange={(event) => setDurationSeconds(event.target.value)}
        >
          <option value="30">30 seconds</option>
          <option value="60">1 minute</option>
          <option value="300">5 minutes</option>
          <option value="600">10 minutes</option>
        </select>
        <Button variant="primary" type="submit">
          Announce
        </Button>
      </form>
      {sent && <span className="announcement-sent">Announcement published.</span>}
    </section>
  );
}

type LiveStrategyUser = {
  user_id: string;
  display_name: string;
  is_admin: number;
  last_seen_at: number;
  current_page?: string;
};

/** A button beside a heading that explains the section in the page. */
function InfoButton({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="info-button"
        aria-label={`What is ${title}?`}
        onClick={() => setOpen(true)}
      >
        <Info size={16} />
      </button>
      {open && (
        <Dialog title={title} onClose={() => setOpen(false)} centered>
          {children}
        </Dialog>
      )}
    </>
  );
}

/** What the Match schedule section's info button explains. */
function ScheduleSourceInfo() {
  return (
    <InfoButton title="Match schedule">
      <p>
        Scouting normally reads the match schedule from The Blue Alliance, and moves everyone on to
        the next match as the event runs.
      </p>
      <p>
        If your event isn't on The Blue Alliance — an off-season, a practice day or a scrimmage —
        switch to a manual schedule and enter the teams and matches yourself, by typing them or
        scanning a photo of the printed schedule. You then set which match everyone is scouting on
        the Competition overview.
      </p>
      <p>
        A manual schedule is deleted three days after the competition ends, and switching back to
        The Blue Alliance deletes its teams and matches. Scouting submissions are kept either way.
      </p>
    </InfoButton>
  );
}

/** Who is in the app right now, inside the Competition overview. */
function LiveUsers() {
  const [users, setUsers] = useState<LiveStrategyUser[]>([]);
  useEffect(() => {
    const load = () =>
      api<{ users: LiveStrategyUser[] }>("/presence")
        .then((result) => setUsers(result.users))
        .catch(() => undefined);
    load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);
  return (
    <div className="live-strategy">
      <h3>Live users</h3>
      {users.map((user) => (
        <div key={user.user_id}>
          <span className="live-dot" />
          <strong>{user.display_name}</strong>
          {Boolean(user.is_admin) && <small>Strategy lead</small>}
          <span>{user.current_page || "forms"}</span>
        </div>
      ))}
      {!users.length && <div className="forms-empty">No one is currently online.</div>}
    </div>
  );
}

function ServiceIssueReport() {
  const questions = useQuestions();
  const chat = chatName(useTeamChat());
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState({ teamName: "", description: "" });
  const [issue, setIssue] = useState<IssueChoice>(emptyIssueChoice);
  const [issueMissing, setIssueMissing] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  if (!open)
    return (
      <button type="button" className="service-issue-launch" onClick={() => setOpen(true)}>
        Report a robot breakdown
      </button>
    );
  return (
    <form
      className="service-issue-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const issueTypes = issueTypesToSend(issue);
        if (!issueTypes) {
          setIssueMissing(true);
          return;
        }
        if (
          !(await questions.confirm(
            `Alert the service crew about ${describeServiceIssue(issueTypes)} for team ${report.teamName}?`,
          ))
        )
          return;
        try {
          await api("/service-tickets", {
            method: "POST",
            body: JSON.stringify({ ...report, issueTypes }),
          });
          setMessageType("success");
          setMessage(`Service crew alerted through ${chat}.`);
          setReport({ teamName: "", description: "" });
          setIssue(emptyIssueChoice);
        } catch (error) {
          setMessageType("error");
          setMessage(error instanceof Error ? error.message : "Could not alert the service crew.");
        }
      }}
    >
      <div>
        <strong>Robot breakdown ticket</strong>
      </div>
      <TextField
        typeable
        className="team-number-input"
        required
        inputMode="numeric"
        pattern="[0-9]+"
        title={`Enter a team number using digits only, such as ${pageTeamNumber}.`}
        value={report.teamName}
        onChange={(event) => setReport({ ...report, teamName: event.target.value })}
        onInput={clearInputError}
        onInvalid={showTeamNumberError}
        placeholder="Team number"
      />
      <IssueTypePicker
        choice={issue}
        missing={issueMissing}
        onChange={(update) => {
          setIssue(update);
          setIssueMissing(false);
        }}
      />
      <TextField
        kind="note"
        value={report.description}
        onChange={(event) => setReport({ ...report, description: event.target.value })}
        placeholder="What appears to be broken?"
      />
      <Button variant="primary" type="submit">
        Alert helpers
      </Button>
      <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {message && (
        <div className={`status-toast ${messageType}`} role="status" aria-live="polite">
          {messageType === "success" ? <CheckCircle2 size={21} /> : <AlertCircle size={21} />}
          <div>
            <strong>{messageType === "success" ? "Helpers alerted" : "Alert failed"}</strong>
            <span>{message}</span>
          </div>
          <button type="button" onClick={() => setMessage("")} aria-label="Dismiss notification">
            <X size={17} />
          </button>
        </div>
      )}
    </form>
  );
}

type EventMatch = {
  key: string;
  label: string;
  matchNumber: number;
  scheduledAt: number | null;
  teams: string[];
  redTeams: string[];
  blueTeams: string[];
};
type EventContext = {
  eventKey: string;
  currentMatchNumber: number | null;
  currentMatch: EventMatch | null;
  /** The match after this scout's, for the countdown bar and the done screen. */
  upcomingMatch?: EventMatch | null;
  tbaCurrentMatch: EventMatch | null;
  assignedTeam: string | null;
  hasSubmittedCurrentMatch: boolean;
  submittedFormIds?: string[];
  onlineScoutCount: number;
  matchSubmissions: {
    id: string;
    submitted_by: string;
    submitted_by_name: string;
    team_name: string;
    created_at: number;
    match_number: number;
    match_key: string | null;
    submitted_late?: number;
  }[];
  nextTeamMatch: EventMatch | null;
  teamSchedule: EventMatch[];
  eventSchedule: EventMatch[];
  onlineAdmins: { user_id: string; display_name: string; last_seen_at: number }[];
  scheduleError: string;
  hasTbaAuthKey: boolean;
  tbaAuthKey: string;
  nexusEventKey: string;
  hasNexusApiKey: boolean;
  nexusApiKey: string;
  scheduleMode: "tba" | "manual";
  submissionWindowSeconds: number | null;
  lateWindowSeconds?: number;
  submissionClosesAt: number | null;
  serverNow: number;
  manualEvent: { event_name: string; ends_at: number; delete_after: number } | null;
  manualTeamNames: Record<string, string>;
};

/** What the worker takes for the scouting window after a match (`submissionWindow` there). */
const MIN_SUBMISSION_WINDOW = 0;
const MAX_SUBMISSION_WINDOW = 1800;
/** And for how long it takes a late report (`lateWindow` there). */
const MAX_LATE_WINDOW = 3600;

async function prepareScheduleFiles(files: File[]) {
  const prepared: File[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      prepared.push(file);
      continue;
    }
    const image = await createImageBitmap(file);
    const originalAspectRatio = image.height / image.width;
    const cameraPhoto =
      file.type === "image/jpeg" && originalAspectRatio > 0.65 && originalAspectRatio < 1.8;
    let baseX = 0;
    let baseY = 0;
    let baseWidth = image.width;
    let baseHeight = image.height;
    if (cameraPhoto) {
      const previewScale = Math.min(1, 320 / Math.max(image.width, image.height));
      const preview = document.createElement("canvas");
      preview.width = Math.max(1, Math.round(image.width * previewScale));
      preview.height = Math.max(1, Math.round(image.height * previewScale));
      const previewContext = preview.getContext("2d");
      if (!previewContext) throw new Error("This browser could not inspect the photo.");
      previewContext.drawImage(image, 0, 0, preview.width, preview.height);
      const pixels = previewContext.getImageData(0, 0, preview.width, preview.height).data;
      let minX = preview.width;
      let minY = preview.height;
      let maxX = 0;
      let maxY = 0;
      let darkPixels = 0;
      for (let y = 0; y < preview.height; y += 1) {
        for (let x = 0; x < preview.width; x += 1) {
          const offset = (y * preview.width + x) * 4;
          const brightness =
            pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
          if (brightness >= 165) continue;
          darkPixels += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      if (darkPixels > 100) {
        const padding = Math.round(Math.max(preview.width, preview.height) * 0.035);
        minX = Math.max(0, minX - padding);
        minY = Math.max(0, minY - padding);
        maxX = Math.min(preview.width - 1, maxX + padding);
        maxY = Math.min(preview.height - 1, maxY + padding);
        baseX = Math.round(minX / previewScale);
        baseY = Math.round(minY / previewScale);
        baseWidth = Math.min(image.width - baseX, Math.round((maxX - minX + 1) / previewScale));
        baseHeight = Math.min(image.height - baseY, Math.round((maxY - minY + 1) / previewScale));
      }
    }
    const aspectRatio = baseHeight / baseWidth;
    const splitVertically = !cameraPhoto && baseHeight > 2200 && aspectRatio > 2;
    const splitHorizontally = !cameraPhoto && baseWidth > 2400 && 1 / aspectRatio > 2.2;
    const divideVertically = splitVertically;
    const divideHorizontally = splitHorizontally;
    const sections = splitVertically || splitHorizontally ? 3 : 1;
    for (let index = 0; index < sections; index += 1) {
      const overlap = 0.05;
      const sectionFraction = 1 / sections;
      const sourceX = divideHorizontally
        ? baseX + Math.round(baseWidth * Math.max(0, index * sectionFraction - overlap))
        : baseX;
      const sourceY = divideVertically
        ? baseY + Math.round(baseHeight * Math.max(0, index * sectionFraction - overlap))
        : baseY;
      const sourceWidth = divideHorizontally
        ? Math.min(
            baseX + baseWidth - sourceX,
            Math.round(baseWidth * (sectionFraction + overlap * 2)),
          )
        : baseWidth;
      const sourceHeight = divideVertically
        ? Math.min(
            baseY + baseHeight - sourceY,
            Math.round(baseHeight * (sectionFraction + overlap * 2)),
          )
        : baseHeight;
      const scale = Math.min(1, (cameraPhoto ? 1900 : 1600) / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not prepare the image.");
      if (cameraPhoto) context.filter = "grayscale(65%) contrast(123%) brightness(104%)";
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error("Could not prepare image."))),
          "image/jpeg",
          0.9,
        ),
      );
      prepared.push(
        new File(
          [blob],
          `${file.name.replace(/\.[^.]+$/, "")}-${cameraPhoto ? "photo" : "section"}-${index + 1}.jpg`,
          { type: "image/jpeg" },
        ),
      );
    }
    image.close();
  }
  if (prepared.length > 4)
    throw new Error(
      "These images produce more than four scan sections. Upload fewer pages at once.",
    );
  return prepared;
}

function ManualModeManager() {
  const questions = useQuestions();
  const names = useTeamNames();
  const [context, setContext] = useState<EventContext | null>(null);
  const [scheduleText, setScheduleText] = useState("");
  const [teamText, setTeamText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const next = await api<EventContext>("/event-context");
    setContext(next);
    if (next.scheduleMode === "manual") {
      const loadedSchedule = next.eventSchedule
        .map((match) =>
          [
            match.matchNumber,
            match.scheduledAt ? new Date(match.scheduledAt).toISOString() : "",
            ...match.teams,
          ].join(","),
        )
        .join("\n");
      setScheduleText((current) => current || loadedSchedule);
    }
    if (next.scheduleMode === "manual") {
      const loadedTeams = Object.entries(next.manualTeamNames || {})
        .map(([number, name]) => `${number},${name}`)
        .join("\n");
      setTeamText((current) => current || loadedTeams);
    }
  }, []);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  function parseEditor() {
    const teams = Object.fromEntries(
      teamText
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [number, ...name] = line.split(",");
          return [number.trim(), name.join(",").trim()];
        }),
    );
    const matches = scheduleText
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [matchNumber, scheduledAt, ...teamNumbers] = line
          .split(",")
          .map((part) => part.trim());
        return {
          matchNumber: Number(matchNumber),
          scheduledAt: scheduledAt || null,
          teams: teamNumbers,
        };
      });
    return { matches, teams };
  }

  const editorRows = scheduleText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(",").map((part) => part.trim());
      return Array.from({ length: 8 }, (_, index) => cells[index] || "");
    });

  function setEditorRows(rows: string[][]) {
    setScheduleText(rows.map((row) => row.join(",")).join("\n"));
  }

  function updateEditorCell(rowIndex: number, cellIndex: number, value: string) {
    const rows = editorRows.map((row) => [...row]);
    rows[rowIndex][cellIndex] = value;
    setEditorRows(rows);
  }

  async function saveSchedule() {
    const schedule = parseEditor();
    const incomplete = schedule.matches
      .filter(
        (match) =>
          !Number.isInteger(match.matchNumber) ||
          match.matchNumber < 1 ||
          match.teams.length !== 6 ||
          match.teams.some((team) => !team),
      )
      .map((match) => match.matchNumber || "new");
    if (incomplete.length) {
      setMessage(
        `Fill every team cell for match${incomplete.length === 1 ? "" : "es"} ${incomplete.join(", ")} before saving.`,
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await api("/manual-schedule", { method: "PUT", body: JSON.stringify(schedule) });
      setMessage("Manual schedule saved.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save schedule.");
    } finally {
      setBusy(false);
    }
  }

  if (context?.scheduleMode !== "manual")
    return (
      <Card className="manual-mode-switch">
        <div className="section-heading">
          <h2>
            Match schedule
            <ScheduleSourceInfo />
          </h2>
          <span>Coming from The Blue Alliance.</span>
        </div>
        <Button
          variant="primary"
          type="button"
          onClick={async () => {
            if (
              !(await questions.confirm(
                "Switch off TBA and use a temporary, manually managed event schedule?",
              ))
            )
              return;
            const name = await questions.prompt("Competition name");
            if (!name) return;
            const date = await questions.prompt(
              "Competition end date (YYYY-MM-DD)",
              new Date().toISOString().slice(0, 10),
            );
            if (!date) return;
            const end = new Date(`${date}T23:59:59`).getTime();
            setBusy(true);
            try {
              await api("/manual-mode", {
                method: "POST",
                body: JSON.stringify({ eventName: name, endsAt: end }),
              });
              await load();
              window.dispatchEvent(new Event("scouting-schedule-mode-changed"));
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
        >
          Switch to all-manual mode
        </Button>
      </Card>
    );

  return (
    <Card className="manual-schedule-panel">
      <header>
        <div className="section-heading">
          <h2>
            Match schedule
            <ScheduleSourceInfo />
          </h2>
          <span>Entered by hand for {context.manualEvent?.event_name}.</span>
        </div>
        <Button
          variant="primary"
          type="button"
          onClick={async () => {
            if (
              !(await questions.confirm(
                "Switch back to TBA mode and delete this event's temporary manual teams and schedule? Scouting submissions are retained.",
              ))
            )
              return;
            await api("/manual-mode", { method: "DELETE" });
            setScheduleText("");
            setTeamText("");
            await load();
            window.dispatchEvent(new Event("scouting-schedule-mode-changed"));
          }}
        >
          Switch back to TBA mode
        </Button>
      </header>
      <p>This schedule is deleted three days after the competition ends.</p>
      <p className="manual-scan-help">
        Upload schedule pages or photos. Nothing goes live until you review and save it.
      </p>
      <div className="manual-import">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,.pdf,.csv,.xlsx,.xls,.docx,.ods,.numbers"
        />
        <label className="secondary-button manual-camera-button">
          Take a photo
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" />
        </label>
        <Button
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={async () => {
            const selectedFiles = [
              ...Array.from(fileRef.current?.files || []),
              ...Array.from(cameraRef.current?.files || []),
            ];
            if (!selectedFiles.length) {
              setMessage("Choose or take one or more schedule photos first.");
              return;
            }
            setBusy(true);
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), 70_000);
            setMessage("Reading schedule…");
            try {
              const files = await prepareScheduleFiles(selectedFiles);
              setMessage(
                files.length > selectedFiles.length
                  ? `Scanning ${files.length} optimized sections…`
                  : "Reading schedule…",
              );
              const data = new FormData();
              for (const file of files) data.append("files", file);
              const result = await api<{
                matches: { matchNumber: number; scheduledAt: string | null; teams: string[] }[];
                teams: Record<string, string>;
                warnings: string[];
                pageCount: number;
                cachedPageCount: number;
              }>("/manual-schedule/extract", {
                method: "POST",
                body: data,
                signal: controller.signal,
              });
              setScheduleText(
                result.matches
                  .map((match) =>
                    [match.matchNumber, match.scheduledAt || "", ...match.teams].join(","),
                  )
                  .join("\n"),
              );
              setTeamText(
                Object.entries(result.teams)
                  .map(([number, name]) => `${number},${name}`)
                  .join("\n"),
              );
              setMessage(
                result.warnings.length
                  ? `Found ${result.matches.length} matches. Some pages need attention: ${result.warnings.join(" ")}`
                  : `Found ${result.matches.length} matches across ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}. Review them, then save.`,
              );
            } catch (error) {
              setMessage(
                error instanceof DOMException && error.name === "AbortError"
                  ? "The scan took too long and was stopped. Try filling the camera frame with the paper and retake the photo."
                  : error instanceof Error
                    ? error.message
                    : "Could not read the schedule.",
              );
            } finally {
              window.clearTimeout(timeoutId);
              setBusy(false);
            }
          }}
        >
          Scan selected pages
        </Button>
      </div>
      <div className="manual-match-editor">
        <div className="manual-editor-heading">
          <div>
            <strong>Review matches</strong>
          </div>
          <Button
            variant="secondary"
            type="button"
            onClick={() =>
              setEditorRows([
                ...editorRows,
                [
                  String((Number(editorRows.at(-1)?.[0]) || editorRows.length) + 1),
                  "",
                  "",
                  "",
                  "",
                  "",
                  "",
                  "",
                ],
              ])
            }
          >
            <Plus size={16} /> Add match
          </Button>
        </div>
        <div className="manual-table-scroll">
          <table className="manual-match-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Red 1</th>
                <th>Red 2</th>
                <th>Red 3</th>
                <th>Blue 1</th>
                <th>Blue 2</th>
                <th>Blue 3</th>
                <th>
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {editorRows.map((row, rowIndex) => (
                <tr key={`${rowIndex}-${row[0]}`}>
                  {row.map((value, cellIndex) =>
                    cellIndex === 1 ? null : (
                      // biome-ignore lint/suspicious/noArrayIndexKey: these eight fixed schedule columns never reorder
                      <td key={cellIndex}>
                        <input
                          type="number"
                          min={1}
                          max={12000}
                          value={value}
                          required
                          className={value ? undefined : "missing-team-cell"}
                          aria-label={`Row ${rowIndex + 1}, column ${cellIndex + 1}`}
                          onChange={(event) =>
                            updateEditorCell(rowIndex, cellIndex, event.target.value)
                          }
                        />
                      </td>
                    ),
                  )}
                  <td>
                    <Button
                      variant="danger"
                      type="button"
                      className="icon-button"
                      aria-label={`Delete match ${row[0] || rowIndex + 1}`}
                      onClick={() =>
                        setEditorRows(editorRows.filter((_, index) => index !== rowIndex))
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  </td>
                </tr>
              ))}
              {!editorRows.length && (
                <tr>
                  <td colSpan={8} className="manual-empty-row">
                    Scan a schedule or add the first match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <details className="manual-advanced-editor">
        <summary>Advanced CSV and team names</summary>
        <div className="manual-editor-grid">
          <label>
            <strong>Matches</strong>
            <small>One per line: match, time, red 1–3, blue 1–3</small>
            <TextField
              multiline
              typeable
              rows={12}
              value={scheduleText}
              onChange={(e) => setScheduleText(e.target.value)}
              placeholder={`1,2026-03-14T09:00:00,${pageTeamNumber},1771,4910,2974,6829,8736`}
            />
          </label>
          <label>
            <strong>Team names</strong>
            <small>Optional: team number, team name</small>
            <TextField
              multiline
              kind="teamNames"
              rows={12}
              value={teamText}
              onChange={(e) => setTeamText(e.target.value)}
              placeholder={`${pageTeamNumber},${names.name}`}
            />
          </label>
        </div>
      </details>
      <Button variant="primary" type="button" disabled={busy} onClick={saveSchedule}>
        <Save size={17} /> Save manual schedule
      </Button>
      {message && <p role="status">{message}</p>}
    </Card>
  );
}

function EventStatus({
  isAdmin,
  isG3IdAdmin,
  onOpenSubmission,
}: {
  isAdmin: boolean;
  engagement?: ReactNode;
  isG3IdAdmin: boolean;
  onOpenSubmission: (submissionId: string) => void;
}) {
  const questions = useQuestions();
  const [context, setContext] = useState<EventContext | null>(null);
  const [eventKey, setEventKey] = useState("");
  const [matchNumber, setMatchNumber] = useState("");
  const [tbaAuthKey, setTbaAuthKey] = useState("");
  const [nexusEventKey, setNexusEventKey] = useState("");
  const [nexusApiKey, setNexusApiKey] = useState("");
  const [submissionWindow, setSubmissionWindow] = useState("");
  const [lateWindow, setLateWindow] = useState("");
  const [showTbaAuthKey, setShowTbaAuthKey] = useState(false);
  const [showNexusApiKey, setShowNexusApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const editingRef = useRef(false);
  const load = useCallback(async () => {
    const result = await api<EventContext>("/event-context");
    setContext(result);
    if (!editingRef.current) {
      setEventKey(result.eventKey);
      setMatchNumber(result.currentMatchNumber?.toString() ?? "");
      setNexusEventKey(result.nexusEventKey || result.eventKey);
      setSubmissionWindow(result.submissionWindowSeconds?.toString() ?? "");
      setLateWindow(result.lateWindowSeconds?.toString() ?? "");
    }
  }, []);
  useEffect(() => {
    load().catch(() => undefined);
    const interval = window.setInterval(() => load().catch(() => undefined), 30_000);
    const refreshMode = () => load().catch(() => undefined);
    window.addEventListener("scouting-schedule-mode-changed", refreshMode);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("scouting-schedule-mode-changed", refreshMode);
    };
  }, [load]);
  async function updateEvent(currentMatchNumber: string) {
    setSaving(true);
    await api("/event-context", {
      method: "PUT",
      body: JSON.stringify({
        eventKey,
        currentMatchNumber,
        tbaAuthKey,
        nexusEventKey,
        nexusApiKey,
        submissionWindowSeconds: submissionWindow,
        lateWindowSeconds: lateWindow,
      }),
    }).finally(() => setSaving(false));
    setTbaAuthKey("");
    setNexusApiKey("");
    editingRef.current = false;
    await load();
  }
  const next = context?.nextTeamMatch;
  const currentMatchSubmissions =
    context?.matchSubmissions.filter((submission) =>
      submission.match_key && context.currentMatch?.key
        ? submission.match_key === context.currentMatch.key
        : submission.match_number === context.currentMatch?.matchNumber,
    ) ?? [];
  return (
    <div className="event-context">
      {isAdmin && (
        <Card className="event-admin-panel competition-overview">
          <header>
            <h2>Competition overview</h2>
          </header>
          <LiveUsers />
          <MatchCoverage />
          <section className="match-submission-status">
            <h3>
              {context?.currentMatch
                ? `${context.currentMatch.label} submissions`
                : "Current match submissions"}
            </h3>
            <div className="match-submission-scroll">
              {currentMatchSubmissions.length ? (
                currentMatchSubmissions.map((submission) => (
                  <button
                    type="button"
                    className="submission-chip"
                    key={submission.id}
                    onClick={() => onOpenSubmission(submission.id)}
                  >
                    <strong>{submission.submitted_by_name}</strong>
                    <span>
                      Team {submission.team_name}
                      {submission.submitted_late ? " · Late" : ""}
                    </span>
                  </button>
                ))
              ) : (
                <span>No submissions yet</span>
              )}
            </div>
          </section>
          <div className="online-admins">
            <strong>
              <Users size={16} /> Online Strategy leads
            </strong>
            <span>
              {context?.onlineAdmins.length
                ? context.onlineAdmins.map((admin) => admin.display_name).join(", ")
                : "No other Strategy leads online"}
            </span>
          </div>
          <form
            onFocus={() => {
              editingRef.current = true;
            }}
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                !(await questions.confirm(
                  context?.scheduleMode === "manual"
                    ? "Update the current manual match?"
                    : "Update the match everyone is scouting?",
                ))
              )
                return;
              await updateEvent(matchNumber);
            }}
          >
            <label>
              <strong>Change Match #</strong>
              <div className="match-counter">
                <button
                  type="button"
                  onClick={() => setMatchNumber(String(Math.max(1, Number(matchNumber || 1) - 1)))}
                  aria-label="Previous match"
                >
                  <Minus size={18} />
                </button>
                <input
                  type="number"
                  min="1"
                  value={matchNumber}
                  onChange={(event) => setMatchNumber(event.target.value)}
                  placeholder="Match"
                />
                <button
                  type="button"
                  onClick={() => setMatchNumber(String(Math.max(1, Number(matchNumber || 0) + 1)))}
                  aria-label="Next match"
                >
                  <Plus size={18} />
                </button>
              </div>
              {context?.scheduleMode !== "manual" && (
                <Button
                  variant="secondary"
                  type="button"
                  className="use-tba-match"
                  disabled={saving || !context?.tbaCurrentMatch}
                  onClick={async () => {
                    const nextMatch = context?.tbaCurrentMatch?.matchNumber;
                    if (!nextMatch) return;
                    setMatchNumber(String(nextMatch));
                    await updateEvent(String(nextMatch));
                  }}
                >
                  Set to current TBA match
                </Button>
              )}
            </label>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? "Updating…" : "Update match"}
            </Button>
          </form>
          {context?.currentMatch && <p>Current: {context.currentMatch.label}</p>}
          {context?.scheduleError && <p className="event-error">{context.scheduleError}</p>}
        </Card>
      )}
      <div className="next-match-status">
        <CalendarClock size={20} />
        <div>
          <span>Next Team {pageTeamNumber} match</span>
          <strong>{next?.label ?? "Schedule unavailable"}</strong>
          {next?.scheduledAt && <time>{new Date(next.scheduledAt).toLocaleString()}</time>}
        </div>
      </div>
      {isAdmin && (
        <Card className="event-admin-panel">
          <header>
            <h2>Event Configuration</h2>
          </header>
          <form
            onFocus={() => {
              editingRef.current = true;
            }}
            onSubmit={async (event) => {
              event.preventDefault();
              if (!(await questions.confirm("Update this event's settings?"))) return;
              await updateEvent(matchNumber);
            }}
          >
            {context?.scheduleMode !== "manual" && (
              <label>
                <strong>TBA Event Key</strong>
                <TextField
                  kind="event"
                  value={eventKey}
                  onChange={(event) => setEventKey(event.target.value)}
                  placeholder="e.g. 2026gacmp"
                />
              </label>
            )}
            {context?.scheduleMode !== "manual" && isG3IdAdmin && (
              <label>
                <strong>TBA Auth Key</strong>
                <div className="secret-field">
                  <input
                    className={inputClass}
                    id="tba-key"
                    type={showTbaAuthKey ? "text" : "password"}
                    value={tbaAuthKey}
                    onChange={(event) => setTbaAuthKey(event.target.value)}
                    placeholder={context?.hasTbaAuthKey ? "Configured" : "Required"}
                  />
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setShowTbaAuthKey((shown) => !shown)}
                    aria-label={showTbaAuthKey ? "Hide TBA auth key" : "Show TBA auth key"}
                  >
                    {showTbaAuthKey ? "Hide" : "Show"}
                  </Button>
                </div>
              </label>
            )}
            {isG3IdAdmin && (
              <label>
                <strong>Nexus Event Key</strong>
                <TextField
                  kind="event"
                  value={nexusEventKey}
                  onChange={(event) => setNexusEventKey(event.target.value)}
                  placeholder="e.g. 2026gacmp"
                />
              </label>
            )}
            {isG3IdAdmin && (
              <label>
                <strong>Nexus API Key</strong>
                <div className="secret-field">
                  <input
                    className={inputClass}
                    id="nexus-key"
                    type={showNexusApiKey ? "text" : "password"}
                    value={nexusApiKey}
                    onChange={(event) => setNexusApiKey(event.target.value)}
                    placeholder={context?.hasNexusApiKey ? "Configured" : "Optional"}
                  />
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => setShowNexusApiKey((shown) => !shown)}
                    aria-label={showNexusApiKey ? "Hide Nexus API key" : "Show Nexus API key"}
                  >
                    {showNexusApiKey ? "Hide" : "Show"}
                  </Button>
                </div>
              </label>
            )}
            {context?.scheduleMode !== "manual" && (
              <label className="window-field">
                <strong>Move on after a match (seconds)</strong>
                <input
                  className={inputClass}
                  type="number"
                  min={MIN_SUBMISSION_WINDOW}
                  max={MAX_SUBMISSION_WINDOW}
                  step="1"
                  value={submissionWindow}
                  onChange={(event) => setSubmissionWindow(event.target.value)}
                  placeholder="120"
                />
                <small className="field-hint">
                  How long scouts have after a match is scored before their form moves to the next
                  match. Anyone who has sent theirs moves on right away.
                </small>
              </label>
            )}
            <label className="window-field">
              <strong>Accept late reports for (seconds)</strong>
              <input
                className={inputClass}
                type="number"
                min={0}
                max={MAX_LATE_WINDOW}
                step="1"
                value={lateWindow}
                onChange={(event) => setLateWindow(event.target.value)}
                placeholder="600"
              />
              <small className="field-hint">
                A report that missed the move can still be sent this long after, and goes to its own
                match, marked late. 0 takes none.
              </small>
            </label>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? "Updating…" : "Update event"}
            </Button>
          </form>
          <details className="team-schedule">
            <summary>Team {pageTeamNumber} schedule</summary>
            {context?.teamSchedule.map((match) => (
              <div key={match.key}>
                <strong>{match.label}</strong>
                <span>{match.teams.join(" · ")}</span>
                {match.scheduledAt && <time>{new Date(match.scheduledAt).toLocaleString()}</time>}
              </div>
            ))}
          </details>
        </Card>
      )}
    </div>
  );
}

export function ScoutingForms({
  isAdmin,
  canManageServiceCrew,
  userId,
}: {
  isAdmin: boolean;
  canManageServiceCrew: boolean;
  /** Whose drafts this device keeps. */
  userId: string;
}) {
  const names = useTeamNames();
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<ScoutingForm[]>([]);
  const [selected, setSelected] = useState<ScoutingForm | null>(null);
  const [editing, setEditing] = useState(false);
  const [pitTeam, setPitTeam] = useState<string | undefined>();
  const [pitSelection, setPitSelection] = useState(0);
  const [category, setCategory] = useState<"scouting" | "pit">("scouting");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [context, setContext] = useState<EventContext | null>(null);
  const load = useCallback(async () => {
    const result = await api<{ forms: ScoutingForm[] }>("/scouting-forms");
    setLoadError("");
    const visible = result.forms.filter(
      (form) => isAdmin || (form.isActive && form.fields.length > 0),
    );
    setForms(visible);
    setSelected(
      (current) =>
        visible.find((form) => form.id === current?.id) ??
        visible.find((form) => form.isActive && form.kind === category) ??
        null,
    );
  }, [isAdmin, category]);
  useEffect(() => {
    load()
      .catch((cause) =>
        setLoadError(cause instanceof Error ? cause.message : "Could not load scouting forms."),
      )
      .finally(() => setLoading(false));
  }, [load]);
  const contextRequest = useRef(0);
  const [contextError, setContextError] = useState("");
  const refreshContext = useCallback(async () => {
    const request = ++contextRequest.current;
    // A poll started before submission must not restore the completed match.
    try {
      const next = await api<EventContext>("/event-context?assign=true", { cache: "no-store" });
      if (request === contextRequest.current) {
        setContext(next);
        setContextError("");
      }
    } catch (error) {
      if (request === contextRequest.current)
        setContextError("Could not refresh the match schedule. Retrying.");
      throw error;
    }
  }, []);
  useEffect(() => {
    const loadMatch = () => refreshContext().catch(() => undefined);
    loadMatch();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") loadMatch();
    }, 10_000);
    const resume = () => {
      if (document.visibilityState === "visible") void loadMatch();
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refreshContext]);
  useEffect(() => {
    document.body.classList.toggle("scouting-workspace-open", isFullscreen);
    if (!isFullscreen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("scouting-workspace-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isFullscreen]);
  return (
    <SharedPage
      title={<>Scouting Forms</>}
      width={isFullscreen ? "full" : "wide"}
      className="scouting-page-frame"
      contentClassName={`page scouting-forms-page ${isFullscreen ? "scouting-forms-fullscreen" : ""}`}
      description={
        context?.nextTeamMatch
          ? `Next ${names.shortName} match: ${context.nextTeamMatch.label}`
          : undefined
      }
      actions=<Button
        variant="secondary"
        type="button"
        className="scouting-fullscreen-toggle"
        onClick={() => setIsFullscreen((current) => !current)}
        aria-pressed={isFullscreen}
      >
        {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        {isFullscreen ? "Exit full screen" : "Full screen"}
      </Button>
    >
      {loading && <Loading />}
      {loadError && (
        <div role="alert">
          <ErrorBanner message={loadError} />
        </div>
      )}
      {!loading && !loadError && !forms.length && (
        <p className="text-sm text-secondary-500">No scouting forms are available.</p>
      )}
      {
        <div className="flex flex-wrap gap-2" role="group" aria-label="Scouting form type">
          {(["scouting", "pit"] as const).map((kind) => (
            <Chip
              key={kind}
              selected={category === kind}
              className="min-h-11"
              onClick={() => {
                if (category === kind) return;
                setPitTeam(undefined);
                setCategory(kind);
                setSelected(
                  forms.find((form) => form.kind === kind && form.isActive) ??
                    (isAdmin ? forms.find((form) => form.kind === kind) : null) ??
                    null,
                );
                setEditing(false);
              }}
            >
              {kind === "pit" ? "Pit scouting" : "Match scouting"}
            </Chip>
          ))}
        </div>
      }
      {isAdmin && (
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            setSelected({
              id: "new",
              name: "",
              kind: category,
              description: "",
              isActive: true,
              fields: [
                {
                  id: crypto.randomUUID(),
                  label: "Notes",
                  type: "longText",
                  required: false,
                  options: [],
                  min: 0,
                  max: 10,
                  step: 1,
                },
              ],
            });
            setPitTeam(undefined);
            setEditing(true);
          }}
        >
          <Plus size={16} />
          New {category === "pit" ? "pit" : "match"} form
        </Button>
      )}
      {category === "scouting" &&
        forms.filter((form) => form.kind === "scouting" && form.isActive && form.fields.length > 0)
          .length > 1 && (
          <p className="text-sm text-secondary-500">
            Complete each active match form for your assigned team. Your answers are saved when you
            switch forms.
          </p>
        )}
      {category === "pit" && (
        <PitCoverage
          refreshKey={context?.serverNow}
          onStart={
            selected?.kind === "pit" && selected.isActive && selected.fields.length > 0 && !editing
              ? (team) => {
                  setPitTeam(team);
                  setPitSelection((current) => current + 1);
                  window.requestAnimationFrame(() =>
                    document
                      .getElementById(`entry-${selected.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  );
                }
              : undefined
          }
        />
      )}
      <div className="form-choice-grid">
        {forms
          .filter((form) => form.kind === category)
          .map((form) => (
            <div
              className={selected?.id === form.id ? "form-choice active" : "form-choice"}
              key={form.id}
            >
              <button
                type="button"
                onClick={() => {
                  setPitTeam(undefined);
                  setSelected(form);
                  setEditing(false);
                }}
              >
                <strong>{form.name}</strong>
                <span
                  className={`text-xs ${form.isActive ? "text-secondary-500" : "text-amber-700"}`}
                >
                  {!form.isActive
                    ? "Inactive"
                    : form.kind === "scouting" && context?.submittedFormIds?.includes(form.id)
                      ? "Submitted for this match"
                      : "Active"}
                </span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="edit-form-button"
                  onClick={() => {
                    setPitTeam(undefined);
                    setSelected(form);
                    setEditing(true);
                  }}
                >
                  <Pencil size={15} /> Edit
                </button>
              )}
            </div>
          ))}
      </div>
      {selected &&
        (editing && isAdmin ? (
          <Editor
            key={selected.id}
            form={selected}
            close={() => setEditing(false)}
            save={async (form) => {
              const saved = await api<{ id?: string }>(
                form.id === "new" ? "/scouting-forms" : `/scouting-forms/${form.id}`,
                {
                  method: form.id === "new" ? "POST" : "PUT",
                  body: JSON.stringify(form),
                },
              );
              await load();
              setSelected({ ...form, id: saved.id ?? form.id });
              setEditing(false);
            }}
          />
        ) : !selected.isActive ? (
          <p className="text-sm text-secondary-500">
            This form is inactive. Edit it to make it available to scouts.
          </p>
        ) : (
          <>
            {contextError && selected.kind === "scouting" && <ErrorBanner message={contextError} />}
            <EntryForm
              key={`${selected.id}:${pitTeam ?? ""}:${pitSelection}`}
              form={selected}
              pitTeam={pitTeam}
              context={context}
              refreshContext={refreshContext}
              scheduleUnavailable={!!contextError}
              userId={userId}
            />
          </>
        ))}
      {selected?.kind === "pit" &&
        (canManageServiceCrew ? <Operations embedded /> : <ServiceIssueReport />)}
    </SharedPage>
  );
}

export function ScoutingAdminPage({
  engagement,
  isG3IdAdmin,
  onOpenSubmission,
}: {
  engagement?: ReactNode;
  isG3IdAdmin: boolean;
  onOpenSubmission: (submissionId: string) => void;
}) {
  return (
    <SharedPage
      title={<>Admin</>}
      width="wide"
      className="scouting-page-frame"
      contentClassName="page scouting-admin-page"
    >
      <AnnouncementManager />
      <EventStatus isAdmin isG3IdAdmin={isG3IdAdmin} onOpenSubmission={onOpenSubmission} />
      {engagement}
      <ManualModeManager />
      <AdminManager isG3IdAdmin={isG3IdAdmin} />
    </SharedPage>
  );
}
