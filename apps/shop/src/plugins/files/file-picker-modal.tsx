import { Button, Dialog, focusRing, inputClass } from "@g3/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PartDefinition, PartFile } from "../../shared/types";
import { useUserNames } from "../../shared/use-user-names";
import { UploadButton, formatBytes, formatInstanceRanges, partLabelOf } from "./part-files-panel";

type SortKey = "newest" | "oldest" | "name" | "type" | "size";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "name", label: "Name A–Z" },
  { key: "type", label: "File type" },
  { key: "size", label: "Largest first" },
];

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 && dot < filename.length - 1 ? filename.slice(dot + 1).toLowerCase() : "";
}

/** Searchable, filterable list of library files; resolves one choice via `onPick`. */
export function FilePickerModal({
  files,
  definitions,
  title = "Choose a file",
  confirmLabel = "Use this file",
  onPick,
  onUploadNew,
  onClose,
}: {
  files: PartFile[];
  definitions: PartDefinition[];
  title?: string;
  confirmLabel?: string;
  onPick: (file: PartFile) => void;
  /** When set, the footer offers uploading a new file instead of picking one. */
  onUploadNew?: (file: File) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const resolveName = useUserNames(files.map((f) => f.uploadedBy));

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const definitionById = useMemo(() => new Map(definitions.map((d) => [d.id, d])), [definitions]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of files) {
      const ext = fileExtension(f.filename);
      counts.set(ext, (counts.get(ext) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [files]);

  /** "Part 1 · Rev A #1–6; Part 2 · Rev B #1–3" */
  const coverage = (f: PartFile) => {
    const byPart = new Map<number, number[]>();
    for (const a of f.assignments) {
      byPart.set(a.partDefinitionId, [...(byPart.get(a.partDefinitionId) ?? []), a.instanceNumber]);
    }
    return [...byPart.entries()].map(([id, numbers]) => {
      const d = definitionById.get(id);
      return `${d ? `${d.name || partLabelOf(d)} (${partLabelOf(d)})` : `Part #${id}`} ${formatInstanceRanges(numbers)}`;
    });
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = files.filter((f) => {
      if (type !== "all" && fileExtension(f.filename) !== type) return false;
      if (!q) return true;
      if (f.filename.toLowerCase().includes(q)) return true;
      return f.assignments.some((a) => {
        const d = definitionById.get(a.partDefinitionId);
        return (
          !!d &&
          (d.onshapePartNumber.toLowerCase().includes(q) || d.name?.toLowerCase().includes(q))
        );
      });
    });
    const byName = (a: PartFile, b: PartFile) => a.filename.localeCompare(b.filename);
    const compare: Record<SortKey, (a: PartFile, b: PartFile) => number> = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      name: byName,
      type: (a, b) =>
        fileExtension(a.filename).localeCompare(fileExtension(b.filename)) || byName(a, b),
      size: (a, b) => b.fileSize - a.fileSize,
    };
    return list.sort(compare[sort]);
  }, [files, search, type, sort, definitionById]);

  const selected = files.find((f) => f.id === selectedId) ?? null;
  const control = `${inputClass} !w-auto`;

  return (
    <Dialog title={title} onClose={onClose} wide>
      <div className="flex flex-wrap gap-2">
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search filename, part number, or part name…"
          className={`${inputClass} flex-1 min-w-[12rem]`}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="File type"
          className={control}
        >
          <option value="all">All types ({files.length})</option>
          {typeCounts.map(([ext, n]) => (
            <option key={ext} value={ext}>
              {ext ? `.${ext}` : "No extension"} ({n})
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort"
          className={control}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <ul className="max-h-[50vh] overflow-y-auto divide-y divide-secondary-200 rounded-lg border border-secondary-200">
        {visible.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-secondary-500">
            {files.length === 0 ? "No files uploaded yet." : "No files match."}
          </li>
        )}
        {visible.map((f) => {
          const ext = fileExtension(f.filename);
          const covers = coverage(f);
          const isSelected = f.id === selectedId;
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setSelectedId(f.id)}
                onDoubleClick={() => onPick(f)}
                aria-pressed={isSelected}
                className={`w-full text-left px-4 py-2.5 ${focusRing} ${
                  isSelected ? "bg-secondary-100" : "hover:bg-secondary-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-secondary-500 bg-inset border border-secondary-200 rounded px-1.5 py-0.5 shrink-0 min-w-[2.75rem] text-center">
                    {ext || "file"}
                  </span>
                  <span
                    className="text-sm font-medium text-secondary-900 truncate"
                    title={f.filename}
                  >
                    {f.filename}
                  </span>
                </div>
                <p className="text-xs text-secondary-400 mt-0.5">
                  {formatBytes(f.fileSize)} · {new Date(f.createdAt).toLocaleDateString()} ·{" "}
                  {resolveName(f.uploadedBy)} · {f.assignments.length} instance
                  {f.assignments.length === 1 ? "" : "s"}
                </p>
                <p className="text-xs text-secondary-500 mt-0.5 truncate">
                  {covers.length === 0 ? "Not assigned to any instances" : covers.join("; ")}
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        {onUploadNew && (
          <UploadButton
            busy={false}
            multiple={false}
            size="md"
            label="Upload a new file…"
            onFiles={([file]) => file && onUploadNew(file)}
          />
        )}
        <span className="flex-1 min-w-0 text-sm text-secondary-500 truncate">
          {selected ? selected.filename : "Select a file"}
        </span>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!selected} onClick={() => selected && onPick(selected)}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
