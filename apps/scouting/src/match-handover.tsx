import { Button, ConfirmButton, tones } from "@g3/ui";
import { AlertCircle, CheckCircle2, Clock, Send } from "lucide-react";
import { useEffect, useState } from "react";
import type { MatchDraft } from "./match-drafts";

/** "1:05" for a number of seconds. */
export function clock(seconds: number) {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function timeOf(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Pinned to the bottom while the form is about to move past a report that isn't sent. It never
 * covers the form: the scout is using these seconds to finish it.
 */
export function MoveOnBar({
  matchLabel,
  nextLabel,
  secondsLeft,
  extendSeconds,
  canExtend,
  sending,
  onSend,
  onExtend,
}: {
  matchLabel: string;
  nextLabel: string | null;
  secondsLeft: number;
  extendSeconds: number;
  canExtend: boolean;
  sending: boolean;
  onSend: () => void;
  onExtend: () => void;
}) {
  // The page keeps toasts and its last button clear of the bar while it's up.
  useEffect(() => {
    document.body.classList.add("scouting-move-bar-open");
    return () => document.body.classList.remove("scouting-move-bar-open");
  }, []);
  const next = nextLabel ?? "the next match";
  return (
    <section
      className="fixed inset-x-0 bottom-0 z-[110] border-t-2 border-amber-400 bg-amber-50 px-4 pt-3 text-amber-950 shadow-[0_-8px_30px_rgba(0,0,0,0.18)]"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      aria-label="Moving to the next match"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3">
        <Clock size={22} aria-hidden className="shrink-0" />
        <div className="min-w-0 flex-1 basis-60">
          <div role="timer" aria-live="off">
            <strong className="block text-base">
              {secondsLeft > 0
                ? `Moving to ${next} in ${clock(secondsLeft)}`
                : `Moving to ${next}…`}
            </strong>
          </div>
          <span className="block text-sm" aria-live="polite">
            Send your {matchLabel} report now. Anything unsent is kept here to send late.
          </span>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {canExtend && (
            <Button
              variant="secondary"
              size="lg"
              className="flex-1 sm:flex-none"
              onClick={onExtend}
            >
              +{extendSeconds} s
            </Button>
          )}
          <Button
            variant="primary"
            size="lg"
            className="flex-1 sm:flex-none"
            disabled={sending}
            onClick={onSend}
          >
            <Send size={17} aria-hidden /> {sending ? "Sending…" : "Send now"}
          </Button>
        </div>
      </div>
    </section>
  );
}

export type NextUp = { label: string; team: string | null; startsAt: number | null };

/**
 * What a scout sees once their report is in, in place of the form until the next match: what was
 * sent, and what's next. It opens the next form on its own when that match starts.
 */
export function DoneScreen({
  sentLabel,
  detail,
  next,
  waiting,
  now,
  opensAt,
  onStart,
}: {
  sentLabel: string;
  detail: string | null;
  /** The next form, once it's ready. */
  next: NextUp | null;
  /** Said instead while the next match isn't open yet. */
  waiting: string;
  now: number;
  /** When the next form opens without a tap. */
  opensAt: number | null;
  onStart: () => void;
}) {
  return (
    <section
      className="grid justify-items-center gap-3 rounded-xl border border-line bg-surface px-5 py-8 text-center"
      aria-live="polite"
    >
      <CheckCircle2 size={48} aria-hidden className="text-green-700" />
      <h2 className="m-0 text-2xl font-bold">{sentLabel} report submitted</h2>
      <p className="m-0 text-sm text-green-700">Saved on the server</p>
      {detail && <p className="m-0 text-secondary-600">{detail}</p>}
      {next ? (
        <div className="mt-3 grid w-full max-w-sm gap-2 rounded-lg bg-inset px-4 py-4">
          <span className="text-sm font-semibold uppercase tracking-wide text-secondary-500">
            Next
          </span>
          <strong className="text-xl">
            {next.label}
            {next.team ? ` · Team ${next.team}` : ""}
          </strong>
          {next.startsAt !== null && (
            <span className="text-secondary-600">
              {next.startsAt > now
                ? `Starts ${timeOf(next.startsAt)}, in ${clock((next.startsAt - now) / 1000)}`
                : "Starting now"}
            </span>
          )}
          <Button size="lg" onClick={onStart}>
            Start {next.label}
          </Button>
          {opensAt !== null && opensAt > now && (
            <small className="text-secondary-500">
              Opens on its own in {clock((opensAt - now) / 1000)}.
            </small>
          )}
        </div>
      ) : (
        <p className="m-0 mt-2 max-w-sm text-secondary-600">{waiting}</p>
      )}
    </section>
  );
}

/** A report kept on this device after its match moved on, to send late or discard. */
function ParkedDraft({
  draft,
  onSend,
  onDiscard,
}: {
  draft: MatchDraft;
  /** Resolves to an error to show, or null once sent. */
  onSend: (draft: MatchDraft) => Promise<string | null>;
  onDiscard: (draft: MatchDraft) => void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  return (
    <div
      className={`flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 ${tones.warning}`}
      role="group"
      aria-label={`Unsent ${draft.matchLabel} report`}
    >
      <AlertCircle size={20} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 basis-56 text-sm">
        <strong className="block">
          Unsent {draft.matchLabel} report · Team {draft.teamName}
        </strong>
        <span className="block">
          Saved {timeOf(draft.savedAt)}. It still goes to {draft.matchLabel}, marked late.
        </span>
        {Boolean(draft.missingDrawingFields?.length) && (
          <span className="block font-semibold">
            Some drawings could not be saved on this device. Check the original open form before
            submitting.
          </span>
        )}
        {error && (
          <span className="mt-1 block font-semibold text-red-700" role="alert">
            {error}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={sending}
          onClick={async () => {
            setSending(true);
            setError("");
            const problem = await onSend(draft);
            setSending(false);
            if (problem) setError(problem);
          }}
        >
          {sending ? "Sending…" : "Send it"}
        </Button>
        <ConfirmButton
          size="sm"
          label="Discard"
          question={`Discard your ${draft.matchLabel} report? It can't be brought back.`}
          onConfirm={() => onDiscard(draft)}
        />
      </div>
    </div>
  );
}

export function ParkedDrafts({
  drafts,
  onSend,
  onDiscard,
}: {
  drafts: MatchDraft[];
  onSend: (draft: MatchDraft) => Promise<string | null>;
  onDiscard: (draft: MatchDraft) => void;
}) {
  if (!drafts.length) return null;
  return (
    <div className="grid gap-2">
      {drafts.map((draft) => (
        <ParkedDraft
          key={`${draft.formId}:${draft.matchKey}`}
          draft={draft}
          onSend={onSend}
          onDiscard={onDiscard}
        />
      ))}
    </div>
  );
}
