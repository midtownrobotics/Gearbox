import { Badge, Button, ErrorBanner } from "@g3/ui";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  batchesOfPart,
  linkFileToPart,
  processNamer,
  stageableRows,
  whyNotStageable,
} from "../../shared/batches";
import { buildInstanceRows } from "../../shared/derive";
import { fetchPartFiles, uploadPartFile } from "../../shared/getters";
import { processPath } from "../../shared/nav";
import type { Batch, PartDefinition, PartFile } from "../../shared/types";
import { useKiosk } from "../../shared/use-auth";
import { type ShopData, refreshShopData } from "../../shared/use-shop-data";
import { BatchLink, BatchStatusBadge, FileLink, linkClass } from "../batches/batch-ui";
import { FilePickerModal } from "./file-picker-modal";
import {
  CountInput,
  MAX_FILE_BYTES,
  NoticeText,
  UploadButton,
  formatInstanceRanges,
} from "./file-ui";

/**
 * A part's files, which are its batches: every batch its instances are in or were sent back out
 * of, each with its file. Linking a file to some of its instances makes a batch of them.
 */
export function PartFilesPanel({
  definition,
  data,
  currentInstanceId,
}: {
  definition: PartDefinition;
  data: ShopData;
  currentInstanceId?: number;
}) {
  const kiosk = useKiosk();
  const processName = processNamer(data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [count, setCount] = useState<string | null>(null);
  // The library, while the pop-up that lists it is open.
  const [library, setLibrary] = useState<PartFile[] | null>(null);

  const rows = useMemo(() => buildInstanceRows(data), [data]);
  const batches = batchesOfPart(definition.id, data.batches);
  const free = stageableRows(rows, data, definition.id);
  const waitingAt = free[0]?.current ? free[0].current.processId : null;
  const wanted = Math.min(Number(count ?? free.length) || 0, free.length);
  const currentNumber = data.instances.find((i) => i.id === currentInstanceId)?.instanceNumber;
  const currentBatch = batches.find((b) =>
    b.instances.some((i) => i.partInstanceId === currentInstanceId && i.removedAt === null),
  );

  async function link(file: () => Promise<PartFile>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { notice: note } = await linkFileToPart(
        rows,
        data,
        definition,
        wanted,
        (await file()).id,
      );
      setNotice(note);
      setCount(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      await refreshShopData();
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {currentNumber !== undefined && (
        <p className="text-sm text-secondary-500">
          This instance (#{currentNumber}){" "}
          {currentBatch ? (
            <>
              is in <BatchLink batch={currentBatch} />
              {currentBatch.file ? (
                <>
                  , with <FileLink file={currentBatch.file} />
                </>
              ) : (
                ", which has no file"
              )}
              .
            </>
          ) : (
            "isn't in a batch, so it has no file."
          )}
        </p>
      )}

      {error && <ErrorBanner message={error} />}
      {notice && <NoticeText message={notice} />}

      {batches.length === 0 ? (
        <p className="text-sm text-secondary-400">
          None of this part's instances has been in a batch.
        </p>
      ) : (
        <ul className="divide-y divide-secondary-200 border border-secondary-200 rounded-lg">
          {batches.map((batch) => (
            <PartBatchRow
              key={batch.id}
              batch={batch}
              definitionId={definition.id}
              current={batch.id === currentBatch?.id}
              processName={processName}
            />
          ))}
        </ul>
      )}

      {kiosk.active ? null : waitingAt === null ? (
        <p className="text-xs text-secondary-500">{whyNotStageable(rows, data, definition)}</p>
      ) : (
        <div className="space-y-2 p-2.5 bg-page border border-secondary-200 rounded-lg">
          <p className="text-xs text-secondary-500">
            {free.length} instance{free.length === 1 ? " is" : "s are"} waiting at{" "}
            <Link to={processPath(waitingAt)} className={linkClass}>
              {processName(waitingAt)}
            </Link>{" "}
            outside a batch. Linking a file to {free.length === 1 ? "it" : "them"} makes a batch.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-secondary-500">Link</span>
            <CountInput value={count ?? String(free.length)} onChange={setCount} />
            <span className="text-xs text-secondary-500">instance{wanted === 1 ? "" : "s"} to</span>
            <UploadButton
              busy={busy}
              disabled={wanted < 1}
              multiple={false}
              label="new upload"
              onFiles={([file]) => {
                if (!file) return;
                if (file.size > MAX_FILE_BYTES) setError(`${file.name} is over the 100 MB limit.`);
                else link(() => uploadPartFile(file));
              }}
            />
            <span className="text-xs text-secondary-400">or</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || wanted < 1}
              onClick={() =>
                fetchPartFiles()
                  .then(setLibrary)
                  .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load."))
              }
            >
              existing file
            </Button>
          </div>
        </div>
      )}

      {library && (
        <FilePickerModal
          files={library}
          batches={data.batches}
          title={`Choose a file for ${wanted} of ${definition.name}`}
          onPick={(file) => {
            setLibrary(null);
            link(async () => file);
          }}
          onClose={() => setLibrary(null)}
        />
      )}
    </div>
  );
}

/** One batch, as a part sees it: its name and status, its file, and which of the part's are in it. */
function PartBatchRow({
  batch,
  definitionId,
  current,
  processName,
}: {
  batch: Batch;
  definitionId: number;
  current: boolean;
  processName: (id: number) => string;
}) {
  const mine = batch.instances.filter((i) => i.partDefinitionId === definitionId);
  const inBatch = mine.filter((i) => i.removedAt === null).map((i) => i.instanceNumber);
  const sentBack = mine.filter((i) => i.removedAt !== null).map((i) => i.instanceNumber);
  return (
    <li className={`px-3 py-2.5 space-y-1 ${current ? "bg-primary-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 truncate text-sm font-semibold">
          <BatchLink batch={batch} />
        </span>
        <BatchStatusBadge batch={batch} processName={processName} />
      </div>
      <p className="text-xs text-secondary-500">
        <span className="font-mono">
          {inBatch.length > 0 ? formatInstanceRanges(inBatch) : "None of this part now"}
        </span>
        {sentBack.length > 0 && (
          <>
            {" · sent back: "}
            <span className="font-mono line-through">{formatInstanceRanges(sentBack)}</span>
          </>
        )}
        {" · "}
        {batch.file ? <FileLink file={batch.file} /> : "No file"}
        {batch.file?.obsolete && (
          <>
            {" "}
            <Badge>Obsolete</Badge>
          </>
        )}
      </p>
    </li>
  );
}
