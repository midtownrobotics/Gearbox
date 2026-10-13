import { ErrorBanner } from "@g3/ui";
import { useState } from "react";
import { batchArrival } from "../../shared/batches";
import type { InstanceRow } from "../../shared/derive";
import type { Batch } from "../../shared/types";
import type { ShopData } from "../../shared/use-shop-data";
import { BatchMoveButtons } from "../batches/batch-actions";
import { BatchFileLine } from "../batches/batch-file";
import { BatchLink, PartNameLink, PriorityTag, plural } from "../batches/batch-ui";
import { formatInstanceRanges, partLabelOf } from "../files/file-ui";

/** A batch at a File Consumer process, with which of its live parts have reached it. */
export type BatchHere = { batch: Batch } & ReturnType<typeof batchArrival>;

/**
 * The batches at a File Consumer process that have a part there: made, and not yet complete
 * there. Each moves as one unit, so its parts aren't listed on their own.
 */
export function batchesHere(
  processId: number,
  data: ShopData,
  rowById: Map<number, InstanceRow>,
): BatchHere[] {
  return data.batches
    .filter(
      (b) =>
        b.consumerProcessId === processId &&
        b.producerStatus === "done" &&
        b.consumerStatus !== "done",
    )
    .map((batch) => ({ batch, ...batchArrival(batch, rowById) }))
    .filter((b) => b.here.length > 0);
}

/**
 * One batch at its File Consumer process, as a row of that process's list: its name (which opens
 * it), its file, the parts in it, and Start and Mark complete for the batch as a whole. A part
 * that failed is sent back from the batch's own view.
 */
export function ConsumerBatchCard({
  item,
  touch,
  onChanged,
}: {
  item: BatchHere;
  touch: boolean;
  onChanged: () => Promise<void>;
}) {
  const { batch, live, here, all } = item;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      await onChanged();
      setBusy(false);
    }
  }

  const byPart = new Map<number, InstanceRow[]>();
  for (const r of live) byPart.set(r.definition.id, [...(byPart.get(r.definition.id) ?? []), r]);

  return (
    <div className={`space-y-2 px-4 ${touch ? "py-4" : "py-3"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={batch.label}>
            <BatchLink batch={batch} />
          </p>
          <p className="text-xs text-secondary-400">Batch · {plural(live.length, "instance")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <BatchMoveButtons
            batch={batch}
            arrived={all}
            nextName={null}
            busy={busy}
            size={touch ? "touch" : "sm"}
            run={run}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-secondary-400">File</span>
        <BatchFileLine batch={batch} />
      </div>

      {error && <ErrorBanner message={error} />}
      {!all && (
        <p className="text-xs text-amber-800">
          {here.length} of its {live.length} instances are here. It can start once they all are.
        </p>
      )}

      <ul className="ml-2 border-l-2 border-secondary-200">
        {[...byPart.values()].map((list) => (
          <li
            key={list[0].definition.id}
            className={`flex items-center gap-2 pl-3 pr-1 text-xs ${touch ? "py-1.5" : "py-0.5"}`}
          >
            <span className="truncate">
              <PartNameLink definition={list[0].definition} />
            </span>
            <span className="font-mono text-secondary-400 shrink-0">
              {partLabelOf(list[0].definition)}
            </span>
            <span className="font-mono text-secondary-500 shrink-0">
              {formatInstanceRanges(list.map((r) => r.instance.instanceNumber))}
            </span>
            {list.some((r) => r.instance.isPriority) && <PriorityTag />}
          </li>
        ))}
      </ul>
    </div>
  );
}
