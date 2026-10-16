import { Button, Dialog, ErrorBanner } from "@g3/ui";
import { useState } from "react";
import { batchComplete, batchMembers, batchStage } from "../../shared/batches";
import { duplicateBatch, fetchDuplicatePlan, moveBatch, sendBatchBack } from "../../shared/getters";
import type { Batch, DuplicatePlan } from "../../shared/types";
import { CompleteButton, type CompleteSize, plural } from "./batch-ui";

/**
 * Start batch and Mark as complete for a batch as one unit, at whichever of its two processes
 * it's at.
 * `arrived` is whether all its parts have reached its File Consumer process: until then it waits.
 * Completing at its File Producer process with no file asks first.
 */
export function BatchMoveButtons({
  batch,
  arrived,
  nextName,
  busy,
  size = "md",
  run,
}: {
  batch: Batch;
  arrived: boolean;
  /** The process its parts go to when it's completed where it is. */
  nextName: string | null;
  busy: boolean;
  size?: CompleteSize;
  run: (action: () => Promise<unknown>) => void;
}) {
  const [asking, setAsking] = useState(false);
  if (batchComplete(batch)) return null;
  const { at, status } = batchStage(batch);
  const blocked = busy || batchMembers(batch).length === 0 || (at === "consumer" && !arrived);
  const complete = () => run(() => moveBatch(batch.id, at, "done"));

  return (
    <>
      {status === "todo" && (
        <Button
          size={size === "sm" ? "sm" : "md"}
          className="whitespace-nowrap"
          disabled={blocked}
          onClick={() => run(() => moveBatch(batch.id, at, "doing"))}
        >
          Start batch
        </Button>
      )}
      <CompleteButton
        size={size}
        disabled={blocked}
        hint={
          at === "consumer"
            ? "Do a quality check before marking this complete!"
            : "Moves every instance in this batch to its next process"
        }
        onClick={() => (at === "producer" && !batch.file ? setAsking(true) : complete())}
      >
        Mark as complete
      </CompleteButton>
      {asking && (
        <Dialog title="Complete without a file?" onClose={() => setAsking(false)}>
          <p className="text-sm text-secondary-500">
            No file has been uploaded for {batch.label}. Its instances will move on
            {nextName ? ` to ${nextName}` : ""} without one.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setAsking(false);
                complete();
              }}
            >
              Mark as complete
            </Button>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Add a file first
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/**
 * Asks where to send a whole batch back to: To Do at its File Consumer process, or all the way to
 * its File Producer process, where parts can be added and taken out again.
 */
export function SendBatchBackDialog({
  batch,
  processName,
  run,
  onClose,
}: {
  batch: Batch;
  processName: (id: number) => string;
  run: (action: () => Promise<unknown>) => void;
  onClose: () => void;
}) {
  const made = processName(batch.processId);
  const used = batch.consumerProcessId === null ? null : processName(batch.consumerProcessId);
  const options: { to: "producer" | "consumer"; label: string; hint: string }[] = [];
  if (batch.producerStatus === "done" && batch.consumerStatus !== "todo" && used) {
    options.push({
      to: "consumer",
      label: `To Do at ${used}`,
      hint: "Its instances go back there with it, to be run again with the same file.",
    });
  }
  options.push({
    to: "producer",
    label: `To Do at ${made}`,
    hint:
      batch.producerStatus === "done"
        ? "Its instances go back there with it. More can then be staged or unstaged, and the file changed."
        : "Its instances go back to To Do with it.",
  });
  const [to, setTo] = useState(options[0].to);

  return (
    <Dialog title="Send batch back" onClose={onClose}>
      <p className="text-sm text-secondary-500">
        {batch.label} moves as one, so all {plural(batchMembers(batch).length, "instance")} in it go
        back together. To send back only one that failed, use Send back beside it.
      </p>
      <fieldset className="space-y-2">
        <legend className="mb-1 block text-sm font-medium text-secondary-700">
          Send it back to
        </legend>
        {options.map((option) => (
          <label key={option.to} className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="send-batch-back"
              checked={to === option.to}
              onChange={() => setTo(option.to)}
              className="mt-1 accent-primary-500"
            />
            <span>
              <span className="block text-sm font-medium text-secondary-900">{option.label}</span>
              <span className="block text-xs text-secondary-500">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            onClose();
            run(() => sendBatchBack(batch.id, to));
          }}
        >
          Send back
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Duplicate batch: asks the worker what a copy would take, then either asks to go ahead or says
 * which parts there aren't enough of. `onMade` gets the new batch.
 */
export function DuplicateBatchButton({
  batch,
  processName,
  busy,
  onMade,
}: {
  batch: Batch;
  processName: (id: number) => string;
  busy: boolean;
  onMade: (copy: Batch) => void | Promise<void>;
}) {
  const [plan, setPlan] = useState<DuplicatePlan | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const made = processName(batch.processId);

  async function attempt(action: () => Promise<void>) {
    setWorking(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setWorking(false);
    }
  }

  const close = () => {
    setPlan(null);
    setError(null);
  };

  return (
    <>
      <Button
        variant="secondary"
        disabled={busy || working}
        onClick={() => attempt(async () => setPlan(await fetchDuplicatePlan(batch.id)))}
      >
        Duplicate batch
      </Button>
      {error && !plan && <ErrorBanner message={error} />}
      {plan?.ok && (
        <Dialog title="Duplicate batch" onClose={close}>
          <p className="text-sm text-secondary-500">
            This makes a new batch at {made}, To Do,
            {batch.file ? ` with the same file (${batch.file.filename})` : " with no file"} and
            these parts:
          </p>
          <ul className="space-y-1 text-sm text-secondary-900">
            {plan.parts.map((part) => (
              <li key={part.partDefinitionId}>
                <span className="font-semibold">
                  {part.needed} × {part.name || part.partNumber}
                </span>{" "}
                <span className="font-mono text-xs text-secondary-500">
                  {part.partNumber} · Rev {part.revision} ·{" "}
                  {part.instanceNumbers.map((n) => `#${n}`).join(", ")}
                </span>
              </li>
            ))}
          </ul>
          {error && <ErrorBanner message={error} />}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={working}
              onClick={() =>
                attempt(async () => {
                  const result = await duplicateBatch(batch.id);
                  if ("batch" in result) {
                    close();
                    await onMade(result.batch);
                  } else {
                    // The parts were taken in the meantime: show what's short now.
                    setPlan(result);
                  }
                })
              }
            >
              Duplicate
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </Dialog>
      )}
      {plan && !plan.ok && (
        <Dialog title="This batch can't be duplicated" onClose={close}>
          {plan.reason ? (
            <ErrorBanner message={plan.reason} />
          ) : (
            <>
              <p className="text-sm text-secondary-500">
                A copy needs as many instances of each part as this batch was made with, waiting at{" "}
                {made} outside any batch. There aren't enough:
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-secondary-500">
                    <th className="py-1 font-medium">Part</th>
                    <th className="py-1 text-right font-medium">Needed</th>
                    <th className="py-1 text-right font-medium">Waiting</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-200">
                  {plan.parts.map((part) => {
                    const short = part.available < part.needed;
                    return (
                      <tr key={part.partDefinitionId}>
                        <td className="py-1.5 pr-2 text-secondary-900">
                          {part.name || part.partNumber}
                          <span className="block font-mono text-xs text-secondary-500">
                            {part.partNumber} · Rev {part.revision}
                          </span>
                        </td>
                        <td className="py-1.5 text-right text-secondary-900">{part.needed}</td>
                        <td
                          className={`py-1.5 text-right font-semibold ${
                            short ? "text-red-700" : "text-secondary-900"
                          }`}
                        >
                          {part.available}
                          {short && (
                            <span className="block text-xs font-normal">
                              {part.needed - part.available} short
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={close}>
              Close
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
