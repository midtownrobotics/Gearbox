import { Badge, Button, type ButtonSize, ConfirmButton } from "@g3/ui";
import { useState } from "react";
import { batchComplete } from "../../shared/batches";
import { fetchPartFiles, setBatchFile, uploadPartFile } from "../../shared/getters";
import type { Batch, PartFile } from "../../shared/types";
import { useKiosk } from "../../shared/use-auth";
import { FilePickerModal } from "../files/file-picker-modal";
import { DownloadLink, MAX_FILE_BYTES, UploadButton } from "../files/file-ui";
import { FileLink } from "./batch-ui";

/** A batch's file: its name (which downloads it) and a Download button, or that it has none. */
export function BatchFileLine({ batch }: { batch: Batch }) {
  if (!batch.file) return <span className="text-sm text-secondary-500 flex-1">No file</span>;
  return (
    <>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
        <FileLink file={batch.file} />
      </span>
      {batch.file.obsolete && <Badge>Obsolete</Badge>}
      <DownloadLink file={batch.file} />
    </>
  );
}

/**
 * The buttons that give a batch its file, change it or take it off: upload one, choose one from
 * the library, remove it. `run` does the change and reloads. Nothing on a kiosk, which can't
 * upload, or once the batch is complete.
 */
export function BatchFileControls({
  batch,
  batches,
  busy,
  size = "sm",
  run,
}: {
  batch: Batch;
  batches: Batch[];
  busy: boolean;
  size?: ButtonSize;
  run: (action: () => Promise<unknown>) => void;
}) {
  const kiosk = useKiosk();
  // The library, while the pop-up that lists it is open.
  const [library, setLibrary] = useState<PartFile[] | null>(null);

  if (batchComplete(batch)) return null;
  if (kiosk.active) {
    return (
      <span className="text-xs text-secondary-500">
        Changing the file needs a regular sign-in. Kiosks can't upload.
      </span>
    );
  }

  function upload(file: File) {
    run(async () => {
      if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over the 100 MB limit.`);
      const uploaded = await uploadPartFile(file);
      await setBatchFile(batch.id, uploaded.id);
    });
  }

  return (
    <>
      <UploadButton
        busy={busy}
        multiple={false}
        onFiles={([file]) => file && upload(file)}
        label="Upload file"
        variant={batch.file ? "secondary" : "primary"}
        size={size}
      />
      <Button
        variant="secondary"
        size={size}
        disabled={busy}
        onClick={() => run(async () => setLibrary(await fetchPartFiles()))}
      >
        Choose existing file
      </Button>
      {batch.file && (
        <ConfirmButton
          size={size}
          label="Remove file"
          confirmLabel="Remove it"
          question={`Remove ${batch.file.filename} from this batch? The file stays in the library.`}
          disabled={busy}
          onConfirm={() => run(() => setBatchFile(batch.id, null))}
        />
      )}
      {library && (
        <FilePickerModal
          files={library.filter((f) => f.id !== batch.fileId)}
          batches={batches}
          title={`${batch.file ? "Replace the file for" : "Choose a file for"} ${batch.label}`}
          confirmLabel={batch.file ? "Replace file" : "Use this file"}
          onPick={(file) => {
            setLibrary(null);
            run(() => setBatchFile(batch.id, file.id));
          }}
          onUploadNew={(file) => {
            setLibrary(null);
            upload(file);
          }}
          onClose={() => setLibrary(null)}
        />
      )}
    </>
  );
}
