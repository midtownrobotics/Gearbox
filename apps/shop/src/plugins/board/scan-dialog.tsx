import { Dialog, ErrorBanner } from "@g3/ui";
import { useEffect, useRef, useState } from "react";
import { type InstanceRow, matchScannedDrawing, partLabel } from "../../shared/derive";

type Props = {
  /** Rows in the queue currently on screen. */
  queue: InstanceRow[];
  /** Every live row, so a part sitting in another queue can be named rather than denied. */
  all: InstanceRow[];
  onFound: (row: InstanceRow) => void;
  onClose: () => void;
};

/**
 * Kiosk scan prompt. The handheld scanner is a keyboard wedge: it types the barcode into the
 * focused field and presses Enter, so a focused input is all that is needed to "wait for" a
 * scan. The field stays focused while the dialog is open in case the tablet moves focus.
 */
export function ScanDialog({ queue, all, onFound, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const id = setInterval(() => {
      if (document.activeElement !== inputRef.current) inputRef.current?.focus();
    }, 500);
    return () => clearInterval(id);
  }, []);

  function submit(scanned: string) {
    const trimmed = scanned.trim();
    if (!trimmed) return;

    const result = matchScannedDrawing(trimmed, queue, all);
    if (result.kind === "found") {
      onFound(result.row);
      return;
    }

    setValue("");
    if (result.kind === "not-in-queue") {
      setError(
        `${partLabel(result.row)} is not in this queue — it is at ${
          result.row.current ? "another process" : "no process"
        }. Scan a part from this station's list.`,
      );
    } else {
      setError(`No part matches "${trimmed}". Check the drawing is the current revision.`);
    }
  }

  return (
    <Dialog title="Scan a drawing" onClose={onClose}>
      <>
        <p className="text-sm text-secondary-500">
          Point the scanner at the barcode in the bottom-left corner of the drawing.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Waiting for scan…"
            aria-label="Scanned barcode"
            className="w-full bg-page border-2 border-dashed border-secondary-300 rounded-xl px-4 py-5 text-2xl font-mono text-center text-secondary-900 placeholder-secondary-400 focus:outline-none focus:border-primary-500 focus:bg-surface transition-colors"
          />
        </form>

        {error ? (
          <ErrorBanner message={error} />
        ) : (
          <p className="text-sm text-secondary-500">
            Or type the number under the barcode and press Enter.
          </p>
        )}
      </>
    </Dialog>
  );
}
