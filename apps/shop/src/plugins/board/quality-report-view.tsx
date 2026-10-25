import { TextField } from "@g3/ui";
import { useState } from "react";
import type { InstanceRow } from "../../shared/derive";
import { replaceFromReport, sendBackFromReport, submitQualityReport } from "../../shared/getters";
import type { QualityReport, QualitySuspect } from "../../shared/types";
import { useAuthUser } from "../../shared/use-auth";
import type { ShopData } from "../../shared/use-shop-data";
import { useUserNames } from "../../shared/use-user-names";
import { DrawingPreview } from "../parts/drawing-preview";
import { shopButton, shopButtonPlain } from "./shop-view";

/** The value the Unsure choice takes among the likely steps. */
const UNSURE = 0;

function when(at: number) {
  return new Date(at).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A quality report on a part waiting at a Quality Control step, over the whole screen beside its
 * drawing. All four checks passing finishes the step. Otherwise the reporter names the steps it
 * likely went wrong at (or Unsure), then sees who did those steps and when, and sends the part back
 * or leaves it at the check.
 */
export function QualityReportView({
  row,
  data,
  onClose,
  onChanged,
}: {
  row: InstanceRow;
  data: ShopData;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const step = row.current;
  const processName = (id: number) => data.processes.find((p) => p.id === id)?.name ?? `#${id}`;
  // The steps before the check, each process once, in the order the part went through them.
  const earlier = step
    ? [...new Set(row.procs.filter((p) => p.index < step.index).map((p) => p.processId))].map(
        (id) => ({ id, name: processName(id) }),
      )
    : [];
  // Every step of the part, so it can be sent to any of them, not only one before the check.
  const allSteps = [...new Set(row.procs.map((p) => p.processId))].map((id) => ({
    id,
    name: processName(id),
  }));
  // A fix can also send it to a plain process the part has never had (sanding a failed part),
  // which joins this one part's steps just before the check.
  const extraSteps = data.processes
    .filter((p) => p.type === "regular" && !allSteps.some((s) => s.id === p.id))
    .map((p) => ({ id: p.id, name: p.name }));
  // The team's checklist, as the Admin page has it.
  const checklist = useAuthUser()?.qualityChecklist ?? [];

  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [likely, setLikely] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ report: QualityReport; history: QualitySuspect[] } | null>(
    null,
  );

  const answers = checklist.map((label) => ({ label, ok: ticked[label] === true }));
  const passing = answers.length > 0 && answers.every((a) => a.ok);

  function toggleLikely(id: number) {
    setLikely((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    if (!step) return;
    if (!passing && likely.length === 0) {
      setError("Pick the step it likely went wrong at, or Unsure.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await submitQualityReport({
        partInstanceId: row.instance.id,
        processId: step.processId,
        checks: answers,
        suspectProcessIds: passing ? [] : likely.filter((id) => id !== UNSURE),
        unsure: !passing && likely.includes(UNSURE),
        notes,
      });
      await onChanged();
      if (result.report.passed) onClose();
      else setFailed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The report didn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-secondary-200 px-4 py-3 lg:px-6 lg:py-5">
        <h1 className="min-w-0 truncate font-display text-2xl text-secondary-900 lg:text-3xl">
          Quality Report: {row.definition.name}
          <span className="ml-2 font-normal text-secondary-500">
            #{row.instance.instanceNumber}
          </span>
        </h1>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 text-3xl text-secondary-500 transition-colors hover:text-secondary-900"
        >
          ✕
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1 border-b border-secondary-200 bg-surface lg:border-b-0 lg:border-r">
          <DrawingPreview
            partNumber={row.definition.onshapePartNumber}
            revision={row.definition.revision}
            hideOverlay
            fullHeight
          />
        </div>

        <div className="flex max-h-[65%] shrink-0 flex-col gap-5 overflow-y-auto p-4 lg:max-h-none lg:w-[28rem] lg:p-6">
          {failed ? (
            <SendBack
              report={failed.report}
              history={failed.history}
              earlier={earlier}
              allSteps={allSteps}
              extraSteps={extraSteps}
              checkName={step ? processName(step.processId) : "the check"}
              onDone={async () => {
                await onChanged();
                onClose();
              }}
            />
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-base font-semibold text-secondary-900">
                  Does the part meet each of these?
                </legend>
                <p className="text-xs text-secondary-500">
                  If one doesn't apply to this part, check it anyway.
                </p>
                {checklist.length === 0 && (
                  <p className="text-sm text-secondary-500">
                    An admin needs to set up the quality checklist first.
                  </p>
                )}
                {checklist.map((label) => (
                  <label
                    key={label}
                    className="flex cursor-pointer select-none items-center gap-3 rounded-lg border border-secondary-200 bg-inset px-3.5 py-3 text-sm text-secondary-900"
                  >
                    <input
                      type="checkbox"
                      checked={ticked[label] === true}
                      onChange={(e) => setTicked({ ...ticked, [label]: e.target.checked })}
                      className="h-5 w-5 accent-primary-500"
                    />
                    {label}
                  </label>
                ))}
              </fieldset>

              {!passing && (
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-base font-semibold text-secondary-900">
                    Which step did the mistake likely happen at?
                  </legend>
                  <p className="text-xs text-secondary-500">
                    Pick at least one. Pick Unsure if you can't tell.
                  </p>
                  {[...earlier, { id: UNSURE, name: "Unsure" }].map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer select-none items-center gap-3 rounded-lg border border-secondary-200 bg-inset px-3.5 py-3 text-sm text-secondary-900"
                    >
                      <input
                        type="checkbox"
                        checked={likely.includes(p.id)}
                        onChange={() => toggleLikely(p.id)}
                        className="h-5 w-5 accent-primary-500"
                      />
                      {p.name}
                    </label>
                  ))}
                </fieldset>
              )}

              <div className="space-y-1">
                <label
                  htmlFor="quality-notes"
                  className="text-base font-semibold text-secondary-900"
                >
                  Notes / Likely Reasons / Problems
                </label>
                <TextField
                  multiline
                  kind="note"
                  id="quality-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  maxLength={2000}
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="mt-auto grid grid-cols-2 gap-2 border-t border-secondary-200 pt-4">
                <button type="button" onClick={onClose} className={shopButtonPlain}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || checklist.length === 0 || (!passing && likely.length === 0)}
                  className={`${shopButton} ${
                    passing
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-primary-500 text-on-primary hover:bg-primary-600"
                  }`}
                >
                  {busy ? "Saving…" : passing ? "Pass Part" : "Report Problem"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** What can be done with a part that failed its check. */
type Outcome = "send-back" | "fix" | "replace";

/**
 * After a failed report: who finished the steps it likely went wrong at and when (every step
 * before the check when the reporter was unsure), then what to do with the part. It can go to any
 * of its steps, go to one with a note on the part saying what to fix, or be obsoleted and made
 * again from the top.
 */
function SendBack({
  report,
  history,
  earlier,
  allSteps,
  extraSteps,
  checkName,
  onDone,
}: {
  report: QualityReport;
  history: QualitySuspect[];
  earlier: { id: number; name: string }[];
  allSteps: { id: number; name: string }[];
  /** Plain processes the part doesn't have, which a fix can add to it. */
  extraSteps: { id: number; name: string }[];
  checkName: string;
  onDone: () => Promise<void>;
}) {
  const shown = report.suspects.length > 0 ? report.suspects : history;
  const resolveName = useUserNames(shown.map((s) => s.completedBy));
  // Start at the earliest step named as a likely cause, else the part's first step.
  const first =
    earlier.find((p) => report.suspects.some((s) => s.processId === p.id)) ?? allSteps[0];
  const [outcome, setOutcome] = useState<Outcome>("send-back");
  const [target, setTarget] = useState<number | null>(first?.id ?? null);
  const [status, setStatus] = useState<"todo" | "doing">("todo");
  const [fixNote, setFixNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const note = fixNote.trim();
  const added = extraSteps.find((p) => p.id === target);
  // Only a fix can add a step, so a step picked for one isn't offered for a plain send back.
  const addsStep = outcome === "fix" && Boolean(added);
  const addedName = added?.name ?? "";
  const canSubmit =
    outcome === "replace"
      ? true
      : target !== null &&
        (outcome === "send-back" ? allSteps.some((s) => s.id === target) : note.length > 0);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      if (outcome === "replace") {
        await replaceFromReport(report.id);
      } else if (target !== null) {
        await sendBackFromReport(report.id, target, status, outcome === "fix" ? note : undefined);
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-secondary-900">
          {report.suspects.length > 0
            ? "Where it likely went wrong"
            : "You weren't sure where it went wrong. Every step before the check:"}
        </h2>
        {shown.length === 0 ? (
          <p className="text-sm text-secondary-500">This part had no steps before the check.</p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((s) => (
              <li
                key={s.processId}
                className="rounded-lg border border-secondary-200 bg-inset px-3.5 py-2.5 text-sm"
              >
                <p className="font-semibold text-secondary-900">{s.name}</p>
                <p className="text-xs text-secondary-600">
                  {s.completedAt
                    ? `Finished ${when(s.completedAt)}${s.completedBy ? ` by ${resolveName(s.completedBy)}` : ""}`
                    : "No finish recorded"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-base font-semibold text-secondary-900">What now?</legend>
        {(
          [
            ["send-back", "Send it back", "It goes to a step and is made through the rest again."],
            [
              "fix",
              "Fix it",
              "It goes to a step, with a note on the part saying what to do. The step can be one this part doesn't have yet.",
            ],
            [
              "replace",
              "Start over",
              "This one becomes obsolete and a new one starts at the first step.",
            ],
          ] as const
        ).map(([value, label, hint]) => (
          <label
            key={value}
            className="flex cursor-pointer select-none items-start gap-3 rounded-lg border border-secondary-200 bg-inset px-3.5 py-3 text-sm text-secondary-900"
          >
            <input
              type="radio"
              name="quality-outcome"
              checked={outcome === value}
              onChange={() => {
                setOutcome(value);
                // Only a fix can add a step, so drop one picked for a fix when leaving it.
                if (value !== "fix" && extraSteps.some((p) => p.id === target)) {
                  setTarget(first?.id ?? null);
                }
              }}
              className="mt-0.5 h-5 w-5 accent-primary-500"
            />
            <span>
              <span className="font-semibold">{label}</span>
              <span className="block text-xs text-secondary-600">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {outcome === "fix" && (
        <div className="space-y-1">
          <label htmlFor="quality-fix-note" className="text-base font-semibold text-secondary-900">
            What has to be done to fix it
          </label>
          <TextField
            multiline
            kind="note"
            id="quality-fix-note"
            value={fixNote}
            onChange={(e) => setFixNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Deburr the top edge and open the two 0.25&quot; holes to size."
          />
          <p className="text-xs text-secondary-500">
            This goes onto the part's notes, so whoever picks it up reads it.
          </p>
        </div>
      )}

      {outcome !== "replace" && allSteps.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-secondary-900">
            {outcome === "fix" ? "Send it to" : "Send the part back to"}
          </h2>
          <select
            aria-label="Step to send the part to"
            value={target ?? ""}
            onChange={(e) => setTarget(Number(e.target.value) || null)}
            className="w-full rounded-lg border border-secondary-300 bg-surface px-3 py-2 text-sm text-secondary-900 focus:border-primary-500 focus:outline-none"
          >
            {outcome === "fix" && extraSteps.length > 0 ? (
              <>
                <optgroup label="This part's steps">
                  {allSteps.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Add a step to this part">
                  {extraSteps.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              </>
            ) : (
              allSteps.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
          {addsStep && (
            <p className="text-xs text-secondary-600">
              {addedName} isn't one of this part's steps. It's added to this part only, just before{" "}
              {checkName}.
            </p>
          )}
          <div className="flex gap-4">
            {(
              [
                ["todo", "To Do"],
                ["doing", "In Progress"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 text-sm text-secondary-900"
              >
                <input
                  type="radio"
                  name="send-back-status"
                  checked={status === value}
                  onChange={() => setStatus(value)}
                  className="accent-amber-500"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-secondary-500">
            Every step after it, {checkName} included, is done again.
          </p>
        </div>
      )}

      {outcome === "replace" && (
        <p className="text-sm text-secondary-600">
          This part is marked obsolete and a new one of the same part is added, waiting at its first
          step. The obsolete one keeps its reports.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="mt-auto grid grid-cols-1 gap-2 border-t border-secondary-200 pt-4">
        <button
          type="button"
          onClick={apply}
          disabled={busy || !canSubmit}
          className={`${shopButton} text-white ${
            outcome === "replace"
              ? "bg-red-600 hover:bg-red-700"
              : "bg-amber-500 hover:bg-amber-600"
          }`}
        >
          {busy
            ? "Working…"
            : outcome === "replace"
              ? "Obsolete and Start Over"
              : outcome === "fix"
                ? "Send to Fix"
                : "↶ Send Back"}
        </button>
        <button type="button" onClick={onDone} disabled={busy} className={shopButtonPlain}>
          Leave it at {checkName} for now
        </button>
      </div>
    </>
  );
}
