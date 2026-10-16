import { Button, type ButtonSize, type ButtonVariant, TextField, buttonClass } from "@g3/ui";
import { useRef } from "react";
import { partFileDownloadUrl } from "../../shared/getters";
import type { PartDefinition, PartFile } from "../../shared/types";

// Small parts the pages that show files and batches share.

export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`;
}

/** [1,2,3,4,6] → "#1–4, #6" */
export function formatInstanceRanges(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `#${sorted[i]}–${sorted[j]}` : `#${sorted[i]}`);
    i = j + 1;
  }
  return parts.join(", ");
}

export const partLabelOf = (d: Pick<PartDefinition, "onshapePartNumber" | "revision">) =>
  `${d.onshapePartNumber} · Rev ${d.revision}`;

/** Digits-only text input so the field can be cleared while typing. */
export function CountInput({
  value,
  onChange,
  label = "How many",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <TextField
      variant="plain"
      typeable
      inputMode="numeric"
      value={value}
      aria-label={label}
      onChange={(e) => {
        if (/^\d{0,4}$/.test(e.target.value)) onChange(e.target.value);
      }}
      className="w-14 bg-surface border border-secondary-300 rounded px-2 py-0.5 text-xs text-secondary-900 text-center focus:outline-none focus:border-primary-500"
    />
  );
}

export function UploadButton({
  busy,
  disabled,
  onFiles,
  label = "Upload files",
  multiple = true,
  variant = "secondary",
  size = "sm",
}: {
  busy: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  label?: string;
  multiple?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          // Reset so picking the same file again still fires onChange.
          e.target.value = "";
          onFiles(picked);
        }}
      />
      <Button
        variant={variant}
        size={size}
        onClick={() => inputRef.current?.click()}
        disabled={busy || disabled}
      >
        {busy ? "Working…" : label}
      </Button>
    </>
  );
}

/**
 * The top of a file's row: its name and details, then its status and buttons. On a narrow screen
 * those go under the details, so the name has the whole row and is shown in full.
 */
export function FileHeading({
  name,
  title,
  details,
  children,
}: {
  /** The name, usually as the link that opens the file. */
  name: React.ReactNode;
  /** The name in full, for when it's cut short. */
  title: string;
  details: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 sm:flex-1">
        <p className="text-sm font-medium text-secondary-900 break-all sm:truncate" title={title}>
          {name}
        </p>
        {details}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:gap-3">{children}</div>
    </div>
  );
}

export function FileMeta({ file, uploader }: { file: PartFile; uploader: string }) {
  return (
    <p className="text-xs text-secondary-400">
      {formatBytes(file.fileSize)} · {new Date(file.createdAt).toLocaleDateString()} · {uploader}
    </p>
  );
}

export function DownloadLink({ file }: { file: PartFile }) {
  return (
    <a
      href={partFileDownloadUrl(file.id)}
      download={file.filename}
      className={`${buttonClass("secondary", "sm")} shrink-0`}
    >
      Download
    </a>
  );
}

/** Something to check, in amber: not an error. */
export function NoticeText({ message }: { message: string }) {
  return (
    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
      {message}
    </p>
  );
}
