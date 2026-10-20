import {
  Badge,
  Button,
  Card,
  Chip,
  ConfirmButton,
  ErrorBanner,
  Field,
  Loading,
  Page,
  SuccessBanner,
  TextField,
  Toggle,
  inputClass,
  tones,
} from "@g3/ui";
import { ArrowDown, ArrowUp, Camera, Plus, Trash2, Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FieldInput } from "./ScoutingForms";
import { api } from "./api";

// Playoff Scouting: strategy leads set up the bracket and alliances, start each match and pick its
// winner; scouts join, take a robot or a whole alliance in each match and answer the team's
// playoff questions. Everyone can read the answers in the Data view.

type Side = "red" | "blue";
type FieldType = "shortText" | "longText" | "mcq" | "multiSelect" | "slider" | "counter";
type AppliesTo = "team" | "overall" | "both";
type Question = {
  id: string;
  label: string;
  type: FieldType;
  options: string[];
  min: number;
  max: number;
  step: number;
  appliesTo: AppliesTo;
};
type Alliance = { seed: number; teams: string[] };
type AssignMode = "claim" | "auto" | "admin";
type BracketMatch = {
  id: string;
  label: string;
  round: string;
  bracket: "upper" | "lower" | "roundrobin" | "finals";
  red: number | null;
  blue: number | null;
  redFrom: string;
  blueFrom: string;
  /** "tie" only in a round robin. */
  winner: Side | "tie" | null;
  needed: boolean;
  redTeams: string[];
  blueTeams: string[];
  startedAt: number | null;
  decidedAt: number | null;
};
type Slot = {
  slot: string;
  side: Side;
  seed: number;
  team: string;
  claim: { userId: string; name: string } | null;
};
type LiveMatch = BracketMatch & { slots: Slot[] };
type Standing = { seed: number; wins: number; losses: number; ties: number; points: number };
/** What a round robin adds to a session: its standings, and whether its finalists are open. */
type RoundRobinView = { roundRobin: boolean; standings: Standing[]; needsFinalists: boolean };
type SessionSummary = {
  id: string;
  eventName: string;
  format: string;
  status: "setup" | "live" | "finished";
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};
type ActiveSession = SessionSummary &
  RoundRobinView & {
    assignMode: AssignMode;
    skipOwn: boolean;
    currentMatchId: string | null;
    openMatchId: string | null;
    ourSeed: number | null;
    alliances: Alliance[];
    champion: number | null;
    bracket: BracketMatch[];
    current: LiveMatch | null;
    open: LiveMatch | null;
    participants: { userId: string; name: string; scouted: number }[];
    me: {
      joined: boolean;
      reports: {
        matchId: string;
        slot: string;
        answers: Record<string, unknown>;
        updatedAt: number;
      }[];
    };
  };
type PlayoffState = {
  canManage: boolean;
  ourTeam: string;
  formats: { id: string; label: string; alliances: number }[];
  questions: Question[];
  session: ActiveSession | null;
};
type Report = {
  id: string;
  matchId: string;
  slot: string;
  seed: number;
  team: string;
  answers: Record<string, unknown>;
  fields: Question[];
  by: string;
  updatedAt: number;
};
type SessionData = RoundRobinView & {
  session: SessionSummary;
  ourSeed: number | null;
  alliances: Alliance[];
  champion: number | null;
  bracket: BracketMatch[];
  questions: Question[];
  reports: Report[];
};

const ASSIGN_MODES: { id: AssignMode; label: string; description: string }[] = [
  {
    id: "claim",
    label: "Scouts pick",
    description: "Each scout picks a free slot before the match.",
  },
  {
    id: "auto",
    label: "Automatic",
    description: "Scouts get a slot as each match comes up, whole alliances first.",
  },
  { id: "admin", label: "Leads assign", description: "Strategy leads give out every slot." },
];
const APPLIES_TO: { id: AppliesTo; label: string }[] = [
  { id: "team", label: "Each robot" },
  { id: "overall", label: "The whole alliance" },
  { id: "both", label: "Both" },
];
const FIELD_TYPES: { id: FieldType; label: string }[] = [
  { id: "longText", label: "Text — long" },
  { id: "shortText", label: "Text — short" },
  { id: "mcq", label: "Multiple choice" },
  { id: "multiSelect", label: "Multiple select" },
  { id: "slider", label: "Slider" },
  { id: "counter", label: "Counter" },
];
const BACKUP_COLUMNS = ["Captain", "Pick 1", "Pick 2", "Backup"];

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";

/** The questions a slot is asked, as the worker picks them. */
const questionsFor = (questions: Question[], slot: string) => {
  const overall = slot.endsWith(":overall");
  return questions.filter(
    (q) => q.appliesTo === "both" || q.appliesTo === (overall ? "overall" : "team"),
  );
};

const allianceName = (seed: number | null, from: string) => (seed ? `Alliance ${seed}` : from);

function slotName(slot: Pick<Slot, "seed" | "team">) {
  return slot.team
    ? `${slot.team} (Alliance ${slot.seed})`
    : `Alliance ${slot.seed}, whole alliance`;
}

/** The red and blue alliances' colors, which mean the side of the field, not a problem. */
const SIDE_BORDER: Record<Side, string> = {
  red: "border-l-4 border-l-red-500",
  blue: "border-l-4 border-l-blue-500",
};

/** Asks the worker again every few seconds while the page is on screen. */
function usePolling<T>(path: string | null, every: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path, { cache: "no-store" }));
      setError("");
    } catch (failure) {
      setError(errorText(failure));
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    void reload();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, every);
    window.addEventListener("focus", reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", reload);
    };
  }, [reload, every]);
  return { data, error, reload };
}

/** Runs a change, then reloads; its error is shown by the caller. */
function useAction(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(
    async (path: string, init?: RequestInit) => {
      setBusy(true);
      setError("");
      try {
        await api(path, init);
        await reload();
        return true;
      } catch (failure) {
        setError(errorText(failure));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );
  return { busy, error, run, setError };
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export function PlayoffScouting({ userId }: { userId: string }) {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "data" ? "data" : "scout";
  const setView = (next: "scout" | "data") =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === "data") updated.set("view", "data");
        else {
          updated.delete("view");
          updated.delete("session");
        }
        return updated;
      },
      { replace: true },
    );
  return (
    <Page
      title="Playoff Scouting"
      description="Watch a robot or a whole alliance in each playoff match."
      actions={
        <div className="flex gap-2" role="group" aria-label="View">
          <Chip selected={view === "scout"} onClick={() => setView("scout")}>
            Scout
          </Chip>
          <Chip selected={view === "data"} onClick={() => setView("data")}>
            Data
          </Chip>
        </div>
      }
    >
      {view === "scout" ? <ScoutView userId={userId} /> : <PlayoffData />}
    </Page>
  );
}

// ---------------------------------------------------------------------------------------------
// Scouting

function ScoutView({ userId }: { userId: string }) {
  const { data: state, error, reload } = usePolling<PlayoffState>("/playoffs", 3000);
  if (!state) return error ? <ErrorBanner message={error} /> : <Loading />;
  const session = state.session;
  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={`Couldn't refresh: ${error}`} />}
      {!session &&
        (state.canManage ? (
          <>
            <NewSession state={state} reload={reload} />
            <QuestionsEditor questions={state.questions} reload={reload} />
          </>
        ) : (
          <Card>
            <p className="text-secondary-700">Playoff scouting hasn't started.</p>
            <p className="mt-1 text-sm text-secondary-500">
              It opens here when a strategy lead starts it. You can read past playoffs under Data.
            </p>
          </Card>
        ))}
      {session?.status === "setup" && (
        <>
          <Setup key={session.id} state={state} session={session} reload={reload} />
          <QuestionsEditor questions={state.questions} reload={reload} />
        </>
      )}
      {session?.status === "live" && (
        <Live state={state} session={session} userId={userId} reload={reload} />
      )}
    </div>
  );
}

function NewSession({ state, reload }: { state: PlayoffState; reload: () => Promise<void> }) {
  const [eventName, setEventName] = useState("");
  const [format, setFormat] = useState(state.formats[0]?.id ?? "double8");
  const action = useAction(reload);
  return (
    <Card title="Set up playoff scouting">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Event">
          <TextField
            kind="title"
            value={eventName}
            onChange={(event) => setEventName(event.target.value)}
            placeholder="Your event's name"
          />
        </Field>
        <Field label="Bracket">
          <select
            className={inputClass}
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            {state.formats.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="mt-3 text-sm text-secondary-500">
        Scouts don't see anything until you start it.
      </p>
      {action.error && (
        <div className="mt-3">
          <ErrorBanner message={action.error} />
        </div>
      )}
      <Button
        className="mt-4"
        disabled={action.busy}
        onClick={() => void action.run("/playoffs/setup", json("POST", { eventName, format }))}
      >
        Set up
      </Button>
    </Card>
  );
}

/** Setting up: the event, the alliances and how scouts get their slots. */
function Setup({
  state,
  session,
  reload,
}: {
  state: PlayoffState;
  session: ActiveSession;
  reload: () => Promise<void>;
}) {
  const [eventName, setEventName] = useState(session.eventName);
  const [format, setFormat] = useState(session.format);
  const [alliances, setAlliances] = useState<string[][]>(() => toGrid(session.alliances));
  const [assignMode, setAssignMode] = useState(session.assignMode);
  const [skipOwn, setSkipOwn] = useState(session.skipOwn);
  const [toCheck, setToCheck] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const action = useAction(reload);
  const count = state.formats.find((item) => item.id === format)?.alliances ?? 8;
  const photo = useRef<HTMLInputElement>(null);

  const rows = Array.from({ length: count }, (_, index) => alliances[index] ?? ["", "", "", ""]);
  const setCell = (row: number, column: number, value: string) => {
    setAlliances(() => {
      const next = rows.map((teams) => [...teams]);
      next[row][column] = value.replace(/\D/g, "").slice(0, 6);
      return next;
    });
    setToCheck((current) => {
      const next = new Set(current);
      next.delete(`${row}:${column}`);
      return next;
    });
  };
  const fill = (filled: Alliance[], unknown: string[] = []) => {
    const grid = toGrid(filled);
    setAlliances(Array.from({ length: count }, (_, index) => grid[index] ?? ["", "", "", ""]));
    const flagged = new Set<string>();
    grid.forEach((teams, row) =>
      teams.forEach((team, column) => {
        if (unknown.includes(team) || (column < 3 && !team && row < count))
          flagged.add(`${row}:${column}`);
      }),
    );
    setToCheck(flagged);
  };
  const body = () => ({
    eventName,
    format,
    assignMode,
    skipOwn,
    alliances: rows.map((teams, index) => ({ seed: index + 1, teams })),
  });
  const save = () => action.run("/playoffs/setup", json("PUT", body()));

  return (
    <Card title="Setup">
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Event">
            <TextField
              kind="title"
              value={eventName}
              onChange={(event) => setEventName(event.target.value)}
            />
          </Field>
          <Field label="Bracket">
            <select
              className={inputClass}
              value={format}
              onChange={(event) => setFormat(event.target.value)}
            >
              {state.formats.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-secondary-900">Alliances</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={action.busy}
                onClick={async () => {
                  action.setError("");
                  setNotice("");
                  try {
                    const result = await api<{ alliances: Alliance[] }>(
                      "/playoffs/alliances/tba",
                      json("POST", {}),
                    );
                    fill(result.alliances);
                    setNotice("Filled from The Blue Alliance. Check them before you start.");
                  } catch (failure) {
                    action.setError(errorText(failure));
                  }
                }}
              >
                Fill from The Blue Alliance
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={action.busy}
                onClick={() => photo.current?.click()}
              >
                <Camera size={15} /> Scan a photo
              </Button>
              <input
                ref={photo}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  action.setError("");
                  setNotice("Reading the photo…");
                  try {
                    const form = new FormData();
                    form.set("file", file);
                    const result = await api<{ alliances: Alliance[]; unknown: string[] }>(
                      "/playoffs/alliances/scan",
                      { method: "POST", body: form },
                    );
                    fill(result.alliances, result.unknown);
                    setNotice(
                      "Read from the photo. Check every number, especially the highlighted ones.",
                    );
                  } catch (failure) {
                    setNotice("");
                    action.setError(errorText(failure));
                  }
                }}
              />
            </div>
          </div>
          {notice && <SuccessBanner message={notice} />}
          <div className="grid grid-cols-[1.25rem_repeat(4,minmax(0,1fr))] items-center gap-x-1.5 gap-y-1.5 text-sm sm:gap-x-2">
            <span />
            {BACKUP_COLUMNS.map((column) => (
              <span key={column} className="truncate text-xs font-medium text-secondary-500">
                {column}
              </span>
            ))}
            {rows.map((teams, row) => [
              <span key={`seed-${row + 1}`} className="font-semibold text-secondary-700">
                {row + 1}
              </span>,
              ...BACKUP_COLUMNS.map((column, index) => (
                <TextField
                  key={`${row + 1}-${column}`}
                  typeable
                  variant="compact"
                  inputMode="numeric"
                  aria-label={`Alliance ${row + 1} ${column}`}
                  value={teams[index] ?? ""}
                  onChange={(event) => setCell(row, index, event.target.value)}
                  className={`w-full min-w-0 ${
                    toCheck.has(`${row}:${index}`) ? "!border-amber-500 !bg-amber-50" : ""
                  }`}
                />
              )),
            ])}
          </div>
          <p className="text-xs text-secondary-500">
            Your team is {state.ourTeam}. A backup only plays when you put it in a match's lineup.
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="font-semibold text-secondary-900">Slots</h3>
          <AssignModePicker value={assignMode} onChange={setAssignMode} />
          <Toggle
            label="Leave our alliance out of automatic slots"
            description="Scouts aren't given our own robots or our alliance."
            checked={skipOwn}
            onChange={setSkipOwn}
          />
        </section>

        {action.error && <ErrorBanner message={action.error} />}
        <div className="flex flex-wrap items-start gap-2">
          <Button
            disabled={action.busy}
            onClick={async () => {
              if (await save()) await action.run("/playoffs/start", json("POST"));
            }}
          >
            Start playoff scouting
          </Button>
          <Button variant="secondary" disabled={action.busy} onClick={() => void save()}>
            Save
          </Button>
          <ConfirmButton
            label="Cancel setup"
            question="Cancel this setup? The alliances you entered are deleted. Your questions stay."
            confirmLabel="Cancel setup"
            disabled={action.busy}
            onConfirm={() => void action.run("/playoffs/setup", json("DELETE"))}
          />
        </div>
      </div>
    </Card>
  );
}

function toGrid(alliances: Alliance[]) {
  const grid: string[][] = [];
  for (const alliance of alliances)
    grid[alliance.seed - 1] = [0, 1, 2, 3].map((index) => alliance.teams[index] ?? "");
  return Array.from({ length: grid.length }, (_, index) => grid[index] ?? ["", "", "", ""]);
}

function AssignModePicker({
  value,
  onChange,
  disabled,
}: {
  value: AssignMode;
  onChange: (mode: AssignMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="How scouts get slots">
        {ASSIGN_MODES.map((mode) => (
          <Chip
            key={mode.id}
            selected={value === mode.id}
            disabled={disabled}
            onClick={() => onChange(mode.id)}
          >
            {mode.label}
          </Chip>
        ))}
      </div>
      <p className="text-sm text-secondary-500">
        {ASSIGN_MODES.find((mode) => mode.id === value)?.description}
      </p>
    </div>
  );
}

/** The team's playoff questions, kept from event to event. */
function QuestionsEditor({
  questions,
  reload,
}: { questions: Question[]; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState(questions);
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, q.options.join(", ")])),
  );
  const [saved, setSaved] = useState(false);
  const action = useAction(reload);
  const patch = (id: string, change: Partial<Question>) => {
    setSaved(false);
    setDraft((current) => current.map((q) => (q.id === id ? { ...q, ...change } : q)));
  };
  const move = (index: number, by: -1 | 1) => {
    setSaved(false);
    setDraft((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + by, 0, moved);
      return next;
    });
  };
  return (
    <Card title="Questions">
      <p className="mb-4 text-sm text-secondary-500">
        Scouts answer these for each match. They stay the same from event to event.
      </p>
      <ol className="space-y-3">
        {draft.map((question, index) => (
          <li key={question.id} className="space-y-2 rounded-lg border border-line bg-inset p-3">
            <div className="flex items-center gap-2">
              <span className="w-5 text-sm font-semibold text-secondary-500">{index + 1}</span>
              <TextField
                kind="question"
                aria-label={`Question ${index + 1}`}
                value={question.label}
                onChange={(event) => patch(question.id, { label: event.target.value })}
              />
              <Button
                variant="secondary"
                size="sm"
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={15} />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label="Move down"
                disabled={index === draft.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={15} />
              </Button>
              <Button
                variant="danger"
                size="sm"
                aria-label="Delete question"
                onClick={() => {
                  setSaved(false);
                  setDraft((current) => current.filter((q) => q.id !== question.id));
                }}
              >
                <Trash2 size={15} />
              </Button>
            </div>
            <div className="grid gap-2 pl-7 sm:grid-cols-2">
              <select
                className={inputClass}
                aria-label="Answer type"
                value={question.type}
                onChange={(event) => patch(question.id, { type: event.target.value as FieldType })}
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                aria-label="Asked about"
                value={question.appliesTo}
                onChange={(event) =>
                  patch(question.id, { appliesTo: event.target.value as AppliesTo })
                }
              >
                {APPLIES_TO.map((item) => (
                  <option key={item.id} value={item.id}>
                    Asked about: {item.label}
                  </option>
                ))}
              </select>
              {(question.type === "mcq" || question.type === "multiSelect") && (
                <div className="sm:col-span-2">
                  <TextField
                    kind="choices"
                    aria-label="Choices"
                    placeholder="Choices, separated by commas"
                    value={choices[question.id] ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setChoices((current) => ({ ...current, [question.id]: value }));
                      patch(question.id, {
                        options: value
                          .split(",")
                          .map((option) => option.trim())
                          .filter(Boolean),
                      });
                    }}
                  />
                </div>
              )}
              {question.type === "slider" && (
                <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                  {(["min", "max", "step"] as const).map((key) => (
                    <Field key={key} label={{ min: "Minimum", max: "Maximum", step: "Step" }[key]}>
                      <input
                        className={inputClass}
                        type="number"
                        value={question[key]}
                        onChange={(event) =>
                          patch(question.id, { [key]: Number(event.target.value) })
                        }
                      />
                    </Field>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            setSaved(false);
            const id = crypto.randomUUID();
            setDraft((current) => [
              ...current,
              {
                id,
                label: "New question",
                type: "longText",
                options: [],
                min: 0,
                max: 10,
                step: 1,
                appliesTo: "both",
              },
            ]);
          }}
        >
          <Plus size={15} /> Add a question
        </Button>
        <Button
          disabled={action.busy}
          onClick={async () => {
            if (await action.run("/playoffs/questions", json("PUT", { fields: draft })))
              setSaved(true);
          }}
        >
          Save questions
        </Button>
      </div>
      {action.error && (
        <div className="mt-3">
          <ErrorBanner message={action.error} />
        </div>
      )}
      {saved && (
        <div className="mt-3">
          <SuccessBanner message="Questions saved." />
        </div>
      )}
    </Card>
  );
}

/** A running session: joining, slots, the forms, and the leads' controls. */
function Live({
  state,
  session,
  userId,
  reload,
}: {
  state: PlayoffState;
  session: ActiveSession;
  userId: string;
  reload: () => Promise<void>;
}) {
  const action = useAction(reload);
  const current = session.current;
  const mySlot = (match: LiveMatch | null) =>
    match?.slots.find((slot) => slot.claim?.userId === userId) ?? null;
  const openSlot = mySlot(session.open);
  const currentSlot = mySlot(current);
  return (
    <>
      <MatchHeader session={session} />
      {action.error && <ErrorBanner message={action.error} />}

      {!session.me.joined ? (
        <Card>
          <p className="text-secondary-700">
            Join to pick what you'll watch in each match and answer the team's questions.
          </p>
          <Button
            size="lg"
            className="mt-4 w-full sm:w-auto"
            disabled={action.busy}
            onClick={() => void action.run("/playoffs/join", json("POST"))}
          >
            Join playoff scouting
          </Button>
        </Card>
      ) : (
        <>
          {session.open && openSlot && (
            <ReportForm
              key={`${session.open.id}:${openSlot.slot}`}
              sessionId={session.id}
              match={session.open}
              slot={openSlot}
              questions={state.questions}
              saved={session.me.reports.find(
                (report) => report.matchId === session.open?.id && report.slot === openSlot.slot,
              )}
              heading={`Finish your ${session.open.label} report`}
              note="It closes when the next match starts."
              reload={reload}
            />
          )}
          {current && (
            <SlotPicker
              match={current}
              session={session}
              userId={userId}
              mine={currentSlot}
              action={action}
            />
          )}
          {current && currentSlot && current.startedAt && (
            <ReportForm
              key={`${current.id}:${currentSlot.slot}`}
              sessionId={session.id}
              match={current}
              slot={currentSlot}
              questions={state.questions}
              saved={session.me.reports.find(
                (report) => report.matchId === current.id && report.slot === currentSlot.slot,
              )}
              heading={`${current.label}: ${slotName(currentSlot)}`}
              note="You can keep editing until the next match starts."
              reload={reload}
            />
          )}
        </>
      )}

      {state.canManage && <LeadControls session={session} reload={reload} />}
      <BracketCard
        bracket={session.bracket}
        currentId={session.currentMatchId}
        ourSeed={session.ourSeed}
        standings={session.roundRobin ? session.standings : []}
      />
      {session.me.joined && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={action.busy}
            onClick={() => void action.run("/playoffs/leave", json("POST"))}
          >
            Leave playoff scouting
          </Button>
        </div>
      )}
    </>
  );
}

function MatchHeader({ session }: { session: ActiveSession }) {
  const current = session.current;
  if (!current)
    return (
      <Card>
        <p className="flex items-center gap-2 text-lg font-semibold text-secondary-900">
          <Trophy size={20} />
          {session.champion
            ? `Alliance ${session.champion} won the playoffs.`
            : session.needsFinalists
              ? "The round robin is over."
              : "No match to play."}
        </p>
        <p className="mt-1 text-sm text-secondary-500">
          {session.needsFinalists
            ? "Alliances are level on points for the finals. A strategy lead chooses the finalists."
            : session.eventName}
        </p>
      </Card>
    );
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-secondary-500">
            {session.eventName} · {current.round}
          </p>
          <p className="text-2xl font-semibold text-secondary-900">{current.label}</p>
          <p className="mt-1 text-secondary-700">
            <span className="font-semibold text-red-700">Alliance {current.red}</span>
            {" vs "}
            <span className="font-semibold text-blue-700">Alliance {current.blue}</span>
          </p>
        </div>
        {current.startedAt ? (
          <Badge colors={tones.success}>In progress</Badge>
        ) : (
          <Badge colors={tones.neutral}>Waiting to start</Badge>
        )}
      </div>
    </Card>
  );
}

function SlotPicker({
  match,
  session,
  userId,
  mine,
  action,
}: {
  match: LiveMatch;
  session: ActiveSession;
  userId: string;
  mine: Slot | null;
  action: ReturnType<typeof useAction>;
}) {
  // Picking is before the match; once it's running, a scout with a slot just sees theirs.
  const picking = session.assignMode === "claim" && !(match.startedAt && mine);
  if (!picking)
    return (
      <Card title="Your slot">
        <p className="text-secondary-800">
          {mine
            ? slotName(mine)
            : "You don't have a slot in this match. A strategy lead gives them out."}
        </p>
        {!match.startedAt && mine && (
          <p className="mt-1 text-sm text-secondary-500">The form opens when the match starts.</p>
        )}
      </Card>
    );
  return (
    <Card title={mine ? "Your slot" : "Pick a slot"}>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["red", "blue"] as const).map((side) => (
          <div key={side} className={`space-y-2 pl-3 ${SIDE_BORDER[side]}`}>
            <p className="text-sm font-semibold text-secondary-700">Alliance {match[side]}</p>
            {match.slots
              .filter((slot) => slot.side === side)
              .map((slot) => {
                const isMine = slot.claim?.userId === userId;
                const taken = slot.claim && !isMine;
                return (
                  <button
                    key={slot.slot}
                    type="button"
                    disabled={Boolean(taken) || action.busy}
                    onClick={() =>
                      void (isMine
                        ? action.run(`/playoffs/matches/${match.id}/claim`, json("DELETE"))
                        : action.run(
                            `/playoffs/matches/${match.id}/claim`,
                            json("PUT", { slot: slot.slot }),
                          ))
                    }
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left ${
                      isMine
                        ? "border-primary-500 bg-primary-50 text-secondary-900"
                        : taken
                          ? "border-line bg-inset text-secondary-400"
                          : "border-line bg-surface text-secondary-900 hover:border-secondary-500"
                    }`}
                  >
                    <span className="font-medium">{slot.team || "Whole alliance"}</span>
                    <span className="text-sm">
                      {isMine ? "You · tap to let go" : (slot.claim?.name ?? "Free")}
                    </span>
                  </button>
                );
              })}
          </div>
        ))}
      </div>
      {mine && !match.startedAt && (
        <p className="mt-3 text-sm text-secondary-500">The form opens when the match starts.</p>
      )}
    </Card>
  );
}

const draftKey = (sessionId: string, matchId: string, slot: string) =>
  `g3-playoff-draft:${sessionId}:${matchId}:${slot}`;

/** Unsent answers are kept on the device for 12 hours, like match form drafts. */
const KEEP_MS = 12 * 60 * 60 * 1000;
type Draft = { savedAt: number; answers: Record<string, unknown> };

function readDraft(key: string): Record<string, unknown> | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as Draft | null;
    return saved && Date.now() - saved.savedAt < KEEP_MS ? saved.answers : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, answers: Record<string, unknown>) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), answers } satisfies Draft));
  } catch {
    // A private window: the answers still go when sent.
  }
}

/** Removes playoff drafts older than 12 hours. */
function clearOldDrafts() {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith("g3-playoff-draft:") && readDraft(key) === null)
        localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing kept to clear.
  }
}

/** One slot's questions. Answers are kept on the device until they're sent. */
function ReportForm({
  sessionId,
  match,
  slot,
  questions,
  saved,
  heading,
  note,
  reload,
}: {
  sessionId: string;
  match: LiveMatch;
  slot: Slot;
  questions: Question[];
  saved: { answers: Record<string, unknown>; updatedAt: number } | undefined;
  heading: string;
  note: string;
  reload: () => Promise<void>;
}) {
  const key = draftKey(sessionId, match.id, slot.slot);
  const [answers, setAnswers] = useState<Record<string, unknown>>(
    () => readDraft(key) ?? saved?.answers ?? {},
  );
  const [sentAt, setSentAt] = useState<number | null>(saved?.updatedAt ?? null);
  const [dirty, setDirty] = useState(() => readDraft(key) !== null);
  const action = useAction(reload);
  useEffect(clearOldDrafts, []);
  const asked = questionsFor(questions, slot.slot);
  const set = (id: string, value: unknown) => {
    const next = { ...answers, [id]: value };
    setAnswers(next);
    setDirty(true);
    writeDraft(key, next);
  };
  return (
    <Card className={SIDE_BORDER[slot.side]}>
      <h2 className="text-lg font-semibold text-secondary-900">{heading}</h2>
      <p className="mb-4 text-sm text-secondary-500">{note}</p>
      <div className="space-y-4">
        {asked.map((question) => (
          <div key={question.id} className="space-y-1.5">
            <label
              htmlFor={`field-${question.id}`}
              className="block text-sm font-medium text-secondary-700"
            >
              {question.label}
            </label>
            <FieldInput
              field={{ ...question, required: false }}
              value={answers[question.id]}
              setValue={(value) => set(question.id, value)}
            />
          </div>
        ))}
      </div>
      {action.error && (
        <div className="mt-3">
          <ErrorBanner message={action.error} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          disabled={action.busy || (!dirty && sentAt !== null)}
          onClick={async () => {
            action.setError("");
            try {
              const result = await api<{ updatedAt: number }>(
                `/playoffs/matches/${match.id}/reports/${encodeURIComponent(slot.slot)}`,
                json("PUT", { answers }),
              );
              setSentAt(result.updatedAt);
              setDirty(false);
              try {
                localStorage.removeItem(key);
              } catch {
                // Nothing kept to remove.
              }
              await reload();
            } catch (failure) {
              action.setError(errorText(failure));
            }
          }}
        >
          {sentAt ? "Send changes" : "Send"}
        </Button>
        {sentAt && (
          <span className="text-sm text-secondary-500">
            {dirty
              ? "Changes not sent yet."
              : `Sent at ${new Date(sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`}
          </span>
        )}
      </div>
    </Card>
  );
}

/** Strategy leads: start the match, pick the winner, give out slots and change lineups. */
function LeadControls({
  session,
  reload,
}: { session: ActiveSession; reload: () => Promise<void> }) {
  const action = useAction(reload);
  const current = session.current;
  const lastDecided = useMemo(
    () =>
      session.bracket
        .filter((match) => match.winner && match.decidedAt)
        .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))[0] ?? null,
    [session.bracket],
  );
  return (
    <Card title="Strategy lead">
      <div className="space-y-5">
        {action.error && <ErrorBanner message={action.error} />}
        {current && (
          <div className="flex flex-wrap gap-2">
            {!current.startedAt && (
              <Button
                size="lg"
                disabled={action.busy}
                onClick={() =>
                  void action.run(`/playoffs/matches/${current.id}/start`, json("POST"))
                }
              >
                Start {current.label}
              </Button>
            )}
            {(["red", "blue"] as const).map((side) => (
              <Button
                key={side}
                size="lg"
                variant="secondary"
                className={SIDE_BORDER[side]}
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    `/playoffs/matches/${current.id}/winner`,
                    json("POST", { winner: side }),
                  )
                }
              >
                Alliance {current[side]} won
              </Button>
            ))}
            {current.bracket === "roundrobin" && (
              <Button
                size="lg"
                variant="secondary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    `/playoffs/matches/${current.id}/winner`,
                    json("POST", { winner: "tie" }),
                  )
                }
              >
                Tie
              </Button>
            )}
          </div>
        )}
        {session.roundRobin && <Finalists session={session} action={action} />}
        {lastDecided && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-secondary-600">
            {lastDecided.label}: {resultText(lastDecided)}.
            <Button
              variant="secondary"
              size="sm"
              disabled={action.busy}
              onClick={() =>
                void action.run(`/playoffs/matches/${lastDecided.id}/winner`, json("DELETE"))
              }
            >
              Undo
            </Button>
          </p>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-secondary-700">How scouts get slots</h3>
          <AssignModePicker
            value={session.assignMode}
            disabled={action.busy}
            onChange={(assignMode) =>
              void action.run("/playoffs/setup", json("PUT", { assignMode }))
            }
          />
        </div>

        {current && <SlotAssigner match={current} session={session} action={action} />}
        {current && !current.winner && (
          <Lineups key={current.id} match={current} alliances={session.alliances} action={action} />
        )}

        <div>
          <h3 className="mb-1 text-sm font-semibold text-secondary-700">
            Scouts ({session.participants.length})
          </h3>
          <p className="text-sm text-secondary-600">
            {session.participants.length
              ? session.participants
                  .map((person) => `${person.name} (${person.scouted})`)
                  .join(", ")
              : "Nobody has joined yet."}
          </p>
        </div>

        <ConfirmButton
          label="Finish playoff scouting"
          question="Finish playoff scouting? Forms close for everyone. The answers stay under Data."
          confirmLabel="Finish"
          disabled={action.busy}
          onConfirm={() => void action.run("/playoffs/finish", json("POST"))}
        />
      </div>
    </Card>
  );
}

function SlotAssigner({
  match,
  session,
  action,
}: {
  match: LiveMatch;
  session: ActiveSession;
  action: ReturnType<typeof useAction>;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-secondary-700">Slots in {match.label}</h3>
        <Button
          variant="secondary"
          size="sm"
          disabled={action.busy || !session.participants.length}
          onClick={() => void action.run(`/playoffs/matches/${match.id}/auto-assign`, json("POST"))}
        >
          Fill free slots
        </Button>
      </div>
      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
        {(["red", "blue"] as const).map((side) => (
          <div key={side} className="space-y-2">
            {match.slots
              .filter((slot) => slot.side === side)
              .map((slot) => (
                <label
                  key={slot.slot}
                  className={`flex items-center justify-between gap-2 rounded-lg bg-inset py-1.5 pr-2 pl-3 text-sm ${SIDE_BORDER[slot.side]}`}
                >
                  <span className="font-medium text-secondary-800">
                    {slot.team || `Alliance ${slot.seed}`}
                    {!slot.team && (
                      <span className="font-normal text-secondary-500"> · whole alliance</span>
                    )}
                    {session.ourSeed === slot.seed && (
                      <span className="font-normal text-secondary-500"> · us</span>
                    )}
                  </span>
                  <select
                    className={`${inputClass} !w-40 !py-1`}
                    value={slot.claim?.userId ?? ""}
                    disabled={action.busy}
                    onChange={(event) =>
                      void action.run(
                        `/playoffs/matches/${match.id}/assign`,
                        json("PUT", { slot: slot.slot, userId: event.target.value || null }),
                      )
                    }
                  >
                    <option value="">Nobody</option>
                    {session.participants.map((person) => (
                      <option key={person.userId} value={person.userId}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Which robots each alliance plays: a backup in, a robot that isn't there out. */
function Lineups({
  match,
  alliances,
  action,
}: {
  match: LiveMatch;
  alliances: Alliance[];
  action: ReturnType<typeof useAction>;
}) {
  const [chosen, setChosen] = useState<Record<Side, string[]>>({
    red: match.redTeams,
    blue: match.blueTeams,
  });
  const changed =
    chosen.red.join() !== match.redTeams.join() || chosen.blue.join() !== match.blueTeams.join();
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-secondary-700">Robots on the field</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["red", "blue"] as const).map((side) => {
          const roster =
            alliances.find((alliance) => alliance.seed === match[side])?.teams.filter(Boolean) ??
            [];
          return (
            <fieldset key={side} className={`space-y-1 pl-3 ${SIDE_BORDER[side]}`}>
              <legend className="text-sm text-secondary-600">Alliance {match[side]}</legend>
              {roster.map((team) => (
                <label key={team} className="flex items-center gap-2 text-sm text-secondary-800">
                  <input
                    type="checkbox"
                    checked={chosen[side].includes(team)}
                    onChange={(event) =>
                      setChosen((current) => ({
                        ...current,
                        [side]: event.target.checked
                          ? roster.filter((t) => t === team || current[side].includes(t))
                          : current[side].filter((t) => t !== team),
                      }))
                    }
                  />
                  {team}
                </label>
              ))}
            </fieldset>
          );
        })}
      </div>
      {changed && (
        <Button
          size="sm"
          disabled={action.busy}
          onClick={() =>
            void action.run(`/playoffs/matches/${match.id}/lineup`, json("PUT", chosen))
          }
        >
          Save robots
        </Button>
      )}
    </div>
  );
}

/** "Alliance 3 won" or "Tie". */
function resultText(match: BracketMatch) {
  if (match.winner === "tie") return "Tie";
  return match.winner ? `Alliance ${match[match.winner]} won` : "";
}

/** A round robin's standings: 2 points a win, 1 a tie. */
function StandingsTable({ standings, ourSeed }: { standings: Standing[]; ourSeed: number | null }) {
  return (
    <table className="mb-5 w-full max-w-md text-sm">
      <thead>
        <tr className="text-left text-xs text-secondary-500">
          <th className="py-1 font-medium">Alliance</th>
          <th className="py-1 text-right font-medium">W-L-T</th>
          <th className="py-1 text-right font-medium">Points</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((row) => (
          <tr key={row.seed} className="border-t border-line">
            <td className="py-1.5 text-secondary-900">
              Alliance {row.seed}
              {ourSeed === row.seed && <span className="text-secondary-500"> (us)</span>}
            </td>
            <td className="py-1.5 text-right text-secondary-700">
              {row.wins}-{row.losses}-{row.ties}
            </td>
            <td className="py-1.5 text-right font-semibold text-secondary-900">{row.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Choosing a round robin's finalists: needed when alliances are level on points for a place,
 * and open until the finals start in case the event ranks them otherwise.
 */
function Finalists({
  session,
  action,
}: {
  session: ActiveSession;
  action: ReturnType<typeof useAction>;
}) {
  const played = session.bracket.filter((match) => match.bracket === "roundrobin");
  const finals = session.bracket.filter((match) => match.bracket === "finals");
  const [first, second] = session.standings;
  const [red, setRed] = useState(finals[0]?.red ?? first?.seed ?? 1);
  const [blue, setBlue] = useState(finals[0]?.blue ?? second?.seed ?? 2);
  if (!played.every((match) => match.winner) || finals.some((match) => match.startedAt))
    return null;
  const pick = (value: number, set: (seed: number) => void, label: string) => (
    <Field label={label}>
      <select
        className={inputClass}
        value={value}
        onChange={(event) => set(Number(event.target.value))}
      >
        {session.standings.map((row) => (
          <option key={row.seed} value={row.seed}>
            Alliance {row.seed} ({row.points} points)
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <div className="space-y-2 rounded-lg border border-line bg-inset p-3">
      <h3 className="text-sm font-semibold text-secondary-800">Finalists</h3>
      <p className="text-sm text-secondary-600">
        {session.needsFinalists
          ? "Alliances are level on points for a place in the finals. Choose the two that play, by the event's own ranking."
          : "The top two play the finals. Change them if the event ranks the alliances differently."}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {pick(red, setRed, "Ranked first")}
        {pick(blue, setBlue, "Ranked second")}
      </div>
      <Button
        size="sm"
        disabled={action.busy || red === blue}
        onClick={() => void action.run("/playoffs/finalists", json("PUT", { seeds: [red, blue] }))}
      >
        Set finalists
      </Button>
    </div>
  );
}

function BracketCard({
  bracket,
  currentId,
  ourSeed,
  standings,
}: {
  bracket: BracketMatch[];
  currentId: string | null;
  ourSeed: number | null;
  standings: Standing[];
}) {
  const rounds = Array.from(new Set(bracket.map((match) => match.round)));
  return (
    <Card title="Bracket">
      {standings.length > 0 && <StandingsTable standings={standings} ourSeed={ourSeed} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rounds.map((round) => (
          <div key={round}>
            <h3 className="mb-1.5 text-sm font-semibold text-secondary-700">{round}</h3>
            <ul className="space-y-1.5">
              {bracket
                .filter((match) => match.round === round && match.needed)
                .map((match) => (
                  <li
                    key={match.id}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      match.id === currentId
                        ? "border-primary-500 bg-primary-50"
                        : "border-line bg-surface"
                    }`}
                  >
                    <span className="font-medium text-secondary-900">{match.label}</span>
                    <span className="block text-secondary-600">
                      {(["red", "blue"] as const).map((side, index) => (
                        <span key={side}>
                          {index === 1 && " vs "}
                          <span
                            className={
                              match.winner === side
                                ? "font-semibold text-secondary-900"
                                : match.winner && match.winner !== "tie"
                                  ? "text-secondary-400 line-through"
                                  : ""
                            }
                          >
                            {allianceName(
                              match[side],
                              side === "red" ? match.redFrom : match.blueFrom,
                            )}
                            {ourSeed && match[side] === ourSeed ? " (us)" : ""}
                          </span>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// The data, for everyone

function PlayoffData() {
  const [params, setParams] = useSearchParams();
  const { data: list, error: listError } = usePolling<{ sessions: SessionSummary[] }>(
    "/playoffs/sessions",
    30_000,
  );
  const sessions = (list?.sessions ?? []).filter((session) => session.status !== "setup");
  const selectedId = params.get("session") ?? sessions[0]?.id ?? null;
  const selected = sessions.find((session) => session.id === selectedId);
  const { data, error, reload } = usePolling<SessionData>(
    selectedId ? `/playoffs/sessions/${selectedId}` : null,
    selected?.status === "live" ? 5000 : 60_000,
  );
  const [by, setBy] = useState<"alliance" | "match">("alliance");
  const [search, setSearch] = useState("");
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    api<PlayoffState>("/playoffs")
      .then((state) => setCanManage(state.canManage))
      .catch(() => undefined);
  }, []);
  const action = useAction(reload);

  if (!list) return listError ? <ErrorBanner message={listError} /> : <Loading />;
  if (!sessions.length)
    return (
      <Card>
        <p className="text-secondary-700">No playoff scouting yet.</p>
      </Card>
    );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Playoffs">
          <select
            className={inputClass}
            value={selectedId ?? ""}
            onChange={(event) =>
              setParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.set("session", event.target.value);
                  return next;
                },
                { replace: true },
              )
            }
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.eventName}
                {session.status === "live" ? " (running)" : ""} ·{" "}
                {new Date(session.startedAt ?? session.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex gap-2" role="group" aria-label="Group by">
          <Chip selected={by === "alliance"} onClick={() => setBy("alliance")}>
            By alliance
          </Chip>
          <Chip selected={by === "match"} onClick={() => setBy("match")}>
            By match
          </Chip>
        </div>
        <div className="min-w-40 flex-1 sm:max-w-56">
          <TextField
            variant="search"
            type="search"
            typeable
            aria-label="Find a team"
            placeholder="Find a team"
            value={search}
            onChange={(event) => setSearch(event.target.value.replace(/\D/g, ""))}
          />
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      {!data ? (
        <Loading />
      ) : (
        <>
          {data.champion && (
            <p className="flex items-center gap-2 text-secondary-700">
              <Trophy size={18} /> Alliance {data.champion} won.
            </p>
          )}
          {by === "alliance" ? (
            <ByAlliance data={data} search={search} />
          ) : (
            <ByMatch data={data} search={search} />
          )}
          {canManage && data.session.status === "finished" && (
            <div className="space-y-2">
              {action.error && <ErrorBanner message={action.error} />}
              <ConfirmButton
                label="Delete these playoffs"
                question="Delete these playoffs and every answer in them? This can't be undone."
                confirmLabel="Delete"
                disabled={action.busy}
                onConfirm={async () => {
                  if (await action.run(`/playoffs/sessions/${data.session.id}`, json("DELETE")))
                    setParams(new URLSearchParams({ view: "data" }), { replace: true });
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

const matchesFor = (data: SessionData, search: string) =>
  data.bracket.filter((match) => {
    if (!match.red || !match.blue || !match.needed) return false;
    if (!search) return true;
    return [...match.redTeams, ...match.blueTeams].some((team) => team.includes(search));
  });

/** Each alliance, with every match it played and what was written about it. */
function ByAlliance({ data, search }: { data: SessionData; search: string }) {
  const alliances = data.alliances.filter(
    (alliance) => !search || alliance.teams.some((team) => team.includes(search)),
  );
  if (!alliances.length)
    return (
      <Card>
        <p className="text-secondary-600">No alliance has that team.</p>
      </Card>
    );
  return (
    <div className="space-y-4">
      {alliances.map((alliance) => {
        const played = data.bracket.filter(
          (match) => match.needed && (match.red === alliance.seed || match.blue === alliance.seed),
        );
        return (
          <Card key={alliance.seed}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-secondary-900">Alliance {alliance.seed}</h2>
              <span className="text-secondary-600">
                {alliance.teams.filter(Boolean).join(" · ")}
              </span>
              {data.ourSeed === alliance.seed && <Badge>Us</Badge>}
              {data.champion === alliance.seed && <Badge colors={tones.success}>Won</Badge>}
            </div>
            {played.length === 0 ? (
              <p className="text-sm text-secondary-500">No matches yet.</p>
            ) : (
              <div className="space-y-4">
                {played.map((match) => {
                  const side: Side = match.red === alliance.seed ? "red" : "blue";
                  const other = side === "red" ? match.blue : match.red;
                  const reports = data.reports.filter(
                    (report) => report.matchId === match.id && report.seed === alliance.seed,
                  );
                  return (
                    <section key={match.id} className={`pl-3 ${SIDE_BORDER[side]}`}>
                      <h3 className="text-sm font-semibold text-secondary-800">
                        {match.label} vs{" "}
                        {allianceName(other, side === "red" ? match.blueFrom : match.redFrom)}
                        {match.winner && (
                          <span
                            className={
                              match.winner === side ? "text-emerald-700" : "text-secondary-500"
                            }
                          >
                            {" "}
                            ·{" "}
                            {match.winner === "tie"
                              ? "Tied"
                              : match.winner === side
                                ? "Won"
                                : "Lost"}
                          </span>
                        )}
                      </h3>
                      <ReportList reports={reports} />
                    </section>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/** Each match, both alliances side by side. */
function ByMatch({ data, search }: { data: SessionData; search: string }) {
  const matches = matchesFor(data, search);
  if (!matches.length)
    return (
      <Card>
        <p className="text-secondary-600">No matches to show.</p>
      </Card>
    );
  return (
    <div className="space-y-4">
      {matches.map((match) => (
        <Card key={match.id}>
          <h2 className="mb-3 text-lg font-semibold text-secondary-900">
            {match.label}
            <span className="text-sm font-normal text-secondary-500"> · {match.round}</span>
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {(["red", "blue"] as const).map((side) => (
              <section key={side} className={`pl-3 ${SIDE_BORDER[side]}`}>
                <h3 className="text-sm font-semibold text-secondary-800">
                  Alliance {match[side]}
                  {data.ourSeed === match[side] ? " (us)" : ""}
                  {match.winner === side && <span className="text-emerald-700"> · Won</span>}
                  {match.winner === "tie" && <span className="text-secondary-500"> · Tied</span>}
                </h3>
                <p className="text-xs text-secondary-500">
                  {(side === "red" ? match.redTeams : match.blueTeams).join(" · ")}
                </p>
                <ReportList
                  reports={data.reports.filter(
                    (report) => report.matchId === match.id && report.slot.startsWith(`${side}:`),
                  )}
                />
              </section>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ReportList({ reports }: { reports: Report[] }) {
  if (!reports.length)
    return <p className="mt-1 text-sm text-secondary-400">Nobody scouted this.</p>;
  // The whole alliance first, then each robot.
  const sorted = [...reports].sort((a, b) => Number(Boolean(a.team)) - Number(Boolean(b.team)));
  return (
    <ul className="mt-2 space-y-2">
      {sorted.map((report) => (
        <li key={report.id} className="rounded-lg bg-inset px-3 py-2">
          <p className="text-sm font-semibold text-secondary-900">
            {report.team || "Whole alliance"}
            <span className="font-normal text-secondary-500"> · {report.by}</span>
          </p>
          <dl className="mt-1 space-y-1 text-sm">
            {report.fields
              .filter((field) => answerText(report.answers[field.id]) !== "")
              .map((field) => (
                <div key={field.id}>
                  <dt className="text-xs text-secondary-500">{field.label}</dt>
                  <dd className="whitespace-pre-wrap text-secondary-800">
                    {answerText(report.answers[field.id])}
                  </dd>
                </div>
              ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function answerText(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined || value === null) return "";
  return String(value);
}
