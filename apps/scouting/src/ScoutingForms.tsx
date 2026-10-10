import { pageTeamNumber } from "@g3/site-config";
import { useTeamNames } from "@g3/ui";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  CheckCircle2,
  GripVertical,
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
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { FormFieldMap } from "./FormFieldMap";
import { Operations } from "./Operations";
import { TeamLookupInput } from "./TeamLookupInput";
import { api } from "./api";
import { clearInputError, showTeamNumberError } from "./input-validation";

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

function FieldInput({
  field,
  value,
  setValue,
  canvasRef,
  canvasKey,
  onDrawingChange,
}: {
  field: ScoutingField;
  value: unknown;
  setValue: (value: unknown) => void;
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  canvasKey?: number;
  onDrawingChange?: (hasDrawing: boolean) => void;
}) {
  const inputId = `field-${field.id}`;
  const [counterInterval, setCounterInterval] = useState<(typeof COUNTER_INTERVALS)[number]>(1);
  if (field.type === "fieldMap" && canvasRef)
    return <FormFieldMap key={canvasKey} canvasRef={canvasRef} onDrawingChange={onDrawingChange} />;
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
            onClick={() => setValue(current - counterInterval)}
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
      <textarea
        id={inputId}
        required={field.required}
        value={String(value ?? "")}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  if (field.type === "mcq")
    return (
      <select
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
    <input
      id={inputId}
      type="text"
      required={field.required}
      value={String(value ?? "")}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

function EntryForm({
  form,
  context,
  refreshContext,
}: {
  form: ScoutingForm;
  context: EventContext | null;
  refreshContext: () => Promise<void>;
}) {
  const [teamName, setTeamName] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const [saving, setSaving] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const canvases = useRef<Record<string, HTMLCanvasElement | null>>({});
  const canvasAdapters = useRef<Record<string, RefObject<HTMLCanvasElement | null>>>({});
  const drawnFields = useRef(new Set<string>());
  const assignedMatchKey = useRef<string | null>(null);
  const currentMatch = context?.currentMatch ?? null;
  useEffect(() => {
    if (form.kind !== "scouting") return;
    const matchKey = context?.currentMatch?.key ?? null;
    if (context?.assignedTeam) {
      setTeamName(context.assignedTeam);
    } else if (matchKey && assignedMatchKey.current !== matchKey) {
      setTeamName("");
    }
    if (matchKey) assignedMatchKey.current = matchKey;
  }, [context?.assignedTeam, context?.currentMatch?.key, form.kind]);
  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const payload = new FormData();
      payload.set("teamName", teamName);
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
      await api(`/scouting-forms/${form.id}/submissions`, { method: "POST", body: payload });
      setAnswers({});
      drawnFields.current.clear();
      setCanvasKey((value) => value + 1);
      setMessageType("success");
      setMessage("Report submitted.");
      await refreshContext();
    } catch (error) {
      setMessageType("error");
      setMessage(error instanceof Error ? error.message : "Could not submit report.");
    } finally {
      setSaving(false);
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
    <form className="scouting-entry" onSubmit={submit}>
      <div className="scouting-form-title">
        <div className="scouting-form-heading-row">
          <h2>{form.name}</h2>
          {form.kind === "scouting" && (
            <div className="scouting-match-summary">
              <strong className="scouting-match-number">
                Match Number:
                <span>{currentMatch?.matchNumber ?? "--"}</span>
              </strong>
              {currentMatch ? (
                <div className="scouting-match-teams">
                  <span className="red-alliance">Red: {currentMatch.redTeams.join(", ")}</span>
                  <span className="blue-alliance">Blue: {currentMatch.blueTeams.join(", ")}</span>
                </div>
              ) : (
                <span>Teams unavailable</span>
              )}
            </div>
          )}
        </div>
      </div>
      <label className="team-entry" htmlFor={`team-${form.id}`}>
        <span>
          Team number <b>*</b>
        </span>
        <TeamLookupInput
          value={teamName}
          onChange={setTeamName}
          inputMode="numeric"
          readOnly={form.kind === "scouting"}
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
              <label htmlFor={`field-${field.id}`}>
                {field.label}
                {field.required && <b> *</b>}
              </label>
              <FieldInput
                field={field}
                value={answers[field.id]}
                setValue={(value) => setAnswers((current) => ({ ...current, [field.id]: value }))}
                canvasRef={mapRef}
                canvasKey={canvasKey}
                onDrawingChange={(hasDrawing) => {
                  if (hasDrawing) drawnFields.current.add(field.id);
                  else drawnFields.current.delete(field.id);
                }}
              />
            </div>
          );
        })}
      </div>
      <button
        type="submit"
        className="primary-button"
        disabled={
          saving || (form.kind === "scouting" && (context?.hasSubmittedCurrentMatch || !teamName))
        }
      >
        <Check size={17} />{" "}
        {saving
          ? "Submitting…"
          : form.kind === "scouting" && context?.hasSubmittedCurrentMatch
            ? "Already submitted"
            : form.kind === "scouting" && !teamName
              ? "Waiting for team"
              : "Submit report"}
      </button>
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
    <div className="form-designer editor-card">
      <div className="form-designer-toolbar">
        <div>
          <h2>Edit {draft.name}</h2>
        </div>
        <button type="button" className="secondary-button" onClick={close}>
          <X size={16} /> Close
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={async () => {
            if (
              !window.confirm(
                `Save these changes to ${draft.name}? Scouts will see the updated form immediately.`,
              )
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
        </button>
      </div>
      {saveError && (
        <div className="editor-save-error" role="alert">
          <AlertCircle size={18} /> {saveError}
        </div>
      )}
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
            <input
              value={field.label}
              onChange={(event) => patch(field.id, { label: event.target.value })}
              placeholder="Question"
            />
            <select
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
              <input
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
              <button
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
              </button>
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
    </div>
  );
}

function AdminManager({ isG3IdAdmin }: { isG3IdAdmin: boolean }) {
  const names = useTeamNames();
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
            if (!window.confirm("Make this person a Strategy lead?")) return;
            await api("/strategy-admins", { method: "POST", body: JSON.stringify({ userId }) });
            setUserId("");
            await load();
          }}
        >
          <select required value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">Select a {names.idName} user</option>
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
          <button className="primary-button" type="submit">
            <Plus size={16} /> Add Strategy Lead
          </button>
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
                  if (!window.confirm(`Remove ${admin.display_name} as a Strategy lead?`)) return;
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
          if (!window.confirm(`Publish this announcement in ${names.appTitle("Strategy")}?`))
            return;
          await api("/announcements", {
            method: "POST",
            body: JSON.stringify({ message, durationSeconds: Number(durationSeconds) }),
          });
          setMessage("");
          setSent(true);
        }}
      >
        <input
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
          value={durationSeconds}
          onChange={(event) => setDurationSeconds(event.target.value)}
        >
          <option value="30">30 seconds</option>
          <option value="60">1 minute</option>
          <option value="300">5 minutes</option>
          <option value="600">10 minutes</option>
        </select>
        <button type="submit" className="primary-button">
          Announce
        </button>
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

function LiveStrategy() {
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
    <section className="live-strategy">
      <h2>See Live Users</h2>
      {users.map((user) => (
        <div key={user.user_id}>
          <span className="live-dot" />
          <strong>{user.display_name}</strong>
          {Boolean(user.is_admin) && <small>Strategy lead</small>}
          <span>{user.current_page || "forms"}</span>
        </div>
      ))}
      {!users.length && <div className="forms-empty">No one is currently online.</div>}
    </section>
  );
}

function ServiceIssueReport() {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState({ teamName: "", issueType: "mechanical", description: "" });
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
        if (
          !window.confirm(
            `Alert the service crew about a ${report.issueType} issue for team ${report.teamName}?`,
          )
        )
          return;
        try {
          await api("/service-tickets", { method: "POST", body: JSON.stringify(report) });
          setMessageType("success");
          setMessage("Service crew alerted through Slack.");
          setReport({ teamName: "", issueType: "mechanical", description: "" });
        } catch (error) {
          setMessageType("error");
          setMessage(error instanceof Error ? error.message : "Could not alert the service crew.");
        }
      }}
    >
      <div>
        <strong>Robot breakdown ticket</strong>
      </div>
      <input
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
      <select
        value={report.issueType}
        onChange={(event) => setReport({ ...report, issueType: event.target.value })}
      >
        <option value="mechanical">Mechanical</option>
        <option value="electrical">Electrical</option>
        <option value="programming">Programming</option>
        <option value="other">Other</option>
      </select>
      <input
        value={report.description}
        onChange={(event) => setReport({ ...report, description: event.target.value })}
        placeholder="What appears to be broken?"
      />
      <button type="submit" className="primary-button">
        Alert helpers
      </button>
      <button type="button" className="secondary-button" onClick={() => setOpen(false)}>
        Cancel
      </button>
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
  tbaCurrentMatch: EventMatch | null;
  assignedTeam: string | null;
  hasSubmittedCurrentMatch: boolean;
  onlineScoutCount: number;
  matchSubmissions: {
    id: string;
    submitted_by: string;
    submitted_by_name: string;
    team_name: string;
    created_at: number;
    match_number: number;
    match_key: string | null;
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
  manualEvent: { event_name: string; ends_at: number; delete_after: number } | null;
  manualTeamNames: Record<string, string>;
};

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
      <section className="manual-mode-switch">
        <button
          type="button"
          className="primary-button"
          onClick={async () => {
            if (
              !window.confirm(
                "Switch off TBA and use a temporary, manually managed event schedule?",
              )
            )
              return;
            const name = window.prompt("Competition name");
            if (!name) return;
            const date = window.prompt(
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
        </button>
        <p>Use a temporary event database when TBA is unavailable.</p>
      </section>
    );

  return (
    <section className="manual-schedule-panel">
      <header>
        <div>
          <strong>All-manual mode</strong>
          <span>{context.manualEvent?.event_name}</span>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={async () => {
            if (
              !window.confirm(
                "Switch back to TBA mode and delete this event's temporary manual teams and schedule? Scouting submissions are retained.",
              )
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
        </button>
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
        <button
          type="button"
          className="secondary-button"
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
        </button>
      </div>
      <div className="manual-match-editor">
        <div className="manual-editor-heading">
          <div>
            <strong>Review matches</strong>
            <small>Correct missing cells, then save.</small>
          </div>
          <button
            type="button"
            className="secondary-button"
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
          </button>
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
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete match ${row[0] || rowIndex + 1}`}
                      onClick={() =>
                        setEditorRows(editorRows.filter((_, index) => index !== rowIndex))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
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
            <textarea
              rows={12}
              value={scheduleText}
              onChange={(e) => setScheduleText(e.target.value)}
              placeholder={`1,2026-03-14T09:00:00,${pageTeamNumber},1771,4910,2974,6829,8736`}
            />
          </label>
          <label>
            <strong>Team names</strong>
            <small>Optional: team number, team name</small>
            <textarea
              rows={12}
              value={teamText}
              onChange={(e) => setTeamText(e.target.value)}
              placeholder={`${pageTeamNumber},${names.name}`}
            />
          </label>
        </div>
      </details>
      <button type="button" className="primary-button" disabled={busy} onClick={saveSchedule}>
        <Save size={17} /> Save manual schedule
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function EventStatus({
  isAdmin,
  isG3IdAdmin,
  onOpenSubmission,
}: {
  isAdmin: boolean;
  isG3IdAdmin: boolean;
  onOpenSubmission: (submissionId: string) => void;
}) {
  const [context, setContext] = useState<EventContext | null>(null);
  const [eventKey, setEventKey] = useState("");
  const [matchNumber, setMatchNumber] = useState("");
  const [tbaAuthKey, setTbaAuthKey] = useState("");
  const [nexusEventKey, setNexusEventKey] = useState("");
  const [nexusApiKey, setNexusApiKey] = useState("");
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
        <section className="event-admin-panel">
          <header>
            <h2>Event Configuration</h2>
          </header>
          <form
            onFocus={() => {
              editingRef.current = true;
            }}
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                !window.confirm(
                  context?.scheduleMode === "manual"
                    ? "Update the current manual match?"
                    : "Update the active TBA event and current match?",
                )
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
                <button
                  type="button"
                  className="secondary-button use-tba-match"
                  disabled={saving || !context?.tbaCurrentMatch}
                  onClick={async () => {
                    const nextMatch = context?.tbaCurrentMatch?.matchNumber;
                    if (!nextMatch) return;
                    setMatchNumber(String(nextMatch));
                    await updateEvent(String(nextMatch));
                  }}
                >
                  Set to current TBA match
                </button>
              )}
            </label>
            {context?.scheduleMode !== "manual" && (
              <label>
                <strong>TBA Event Key</strong>
                <input
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
                    id="tba-key"
                    type={showTbaAuthKey ? "text" : "password"}
                    value={tbaAuthKey}
                    onChange={(event) => setTbaAuthKey(event.target.value)}
                    placeholder={context?.hasTbaAuthKey ? "Configured" : "Required"}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowTbaAuthKey((shown) => !shown)}
                    aria-label={showTbaAuthKey ? "Hide TBA auth key" : "Show TBA auth key"}
                  >
                    {showTbaAuthKey ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
            )}
            {isG3IdAdmin && (
              <label>
                <strong>Nexus Event Key</strong>
                <input
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
                    id="nexus-key"
                    type={showNexusApiKey ? "text" : "password"}
                    value={nexusApiKey}
                    onChange={(event) => setNexusApiKey(event.target.value)}
                    placeholder={context?.hasNexusApiKey ? "Configured" : "Optional"}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowNexusApiKey((shown) => !shown)}
                    aria-label={showNexusApiKey ? "Hide Nexus API key" : "Show Nexus API key"}
                  >
                    {showNexusApiKey ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
            )}
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? "Updating…" : "Update event"}
            </button>
          </form>
          {context?.currentMatch && <p>Current: {context.currentMatch.label}</p>}
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
                    <span>Team {submission.team_name}</span>
                  </button>
                ))
              ) : (
                <span>No submissions yet</span>
              )}
            </div>
          </section>
          {context?.scheduleError && <p className="event-error">{context.scheduleError}</p>}
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
        </section>
      )}
      <div className="next-match-status">
        <CalendarClock size={20} />
        <div>
          <span>Next Team {pageTeamNumber} match</span>
          <strong>{next?.label ?? "Schedule unavailable"}</strong>
          {next?.scheduledAt && <time>{new Date(next.scheduledAt).toLocaleString()}</time>}
        </div>
      </div>
    </div>
  );
}

export function ScoutingForms({
  isAdmin,
  canManageServiceCrew,
}: {
  isAdmin: boolean;
  canManageServiceCrew: boolean;
}) {
  const names = useTeamNames();
  const [forms, setForms] = useState<ScoutingForm[]>([]);
  const [selected, setSelected] = useState<ScoutingForm | null>(null);
  const [editing, setEditing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [context, setContext] = useState<EventContext | null>(null);
  const load = useCallback(async () => {
    const result = await api<{ forms: ScoutingForm[] }>("/scouting-forms");
    setForms(result.forms);
    setSelected(
      (current) => result.forms.find((form) => form.id === current?.id) ?? result.forms[0] ?? null,
    );
  }, []);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);
  useEffect(() => {
    const loadMatch = () =>
      api<EventContext>("/event-context?assign=true")
        .then(setContext)
        .catch(() => undefined);
    loadMatch();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") loadMatch();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, []);
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
    <section
      className={`page scouting-forms-page ${isFullscreen ? "scouting-forms-fullscreen" : ""}`}
    >
      <div className="page-heading">
        <div className="scouting-heading-title">
          <h1>Scouting Forms</h1>
          <span>
            Next {names.shortName} match: {context?.nextTeamMatch?.label ?? "Unavailable"}
          </span>
        </div>
        <button
          type="button"
          className="secondary-button scouting-fullscreen-toggle"
          onClick={() => setIsFullscreen((current) => !current)}
          aria-pressed={isFullscreen}
        >
          {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          {isFullscreen ? "Exit full screen" : "Full screen"}
        </button>
      </div>
      <div className="form-choice-grid">
        {forms.map((form) => (
          <div
            className={selected?.id === form.id ? "form-choice active" : "form-choice"}
            key={form.id}
          >
            <button
              type="button"
              onClick={() => {
                setSelected(form);
                setEditing(false);
              }}
            >
              <strong>{form.name}</strong>
            </button>
            {isAdmin && (
              <button
                type="button"
                className="edit-form-button"
                onClick={() => {
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
              await api(`/scouting-forms/${form.id}`, {
                method: "PUT",
                body: JSON.stringify(form),
              });
              await load();
              setEditing(false);
            }}
          />
        ) : (
          <EntryForm
            key={selected.id}
            form={selected}
            context={context}
            refreshContext={async () => {
              setContext(await api<EventContext>("/event-context"));
            }}
          />
        ))}
      {selected?.kind === "pit" &&
        (canManageServiceCrew ? <Operations embedded /> : <ServiceIssueReport />)}
    </section>
  );
}

export function ScoutingAdminPage({
  isG3IdAdmin,
  onOpenSubmission,
}: {
  isG3IdAdmin: boolean;
  onOpenSubmission: (submissionId: string) => void;
}) {
  return (
    <section className="page scouting-admin-page">
      <div className="page-heading">
        <div>
          <h1>Admin</h1>
        </div>
      </div>
      <ManualModeManager />
      <EventStatus isAdmin isG3IdAdmin={isG3IdAdmin} onOpenSubmission={onOpenSubmission} />
      <AdminManager isG3IdAdmin={isG3IdAdmin} />
      <LiveStrategy />
      <AnnouncementManager />
    </section>
  );
}
