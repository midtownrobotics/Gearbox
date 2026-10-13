import { Button, ErrorBanner } from "@g3/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type InstanceRow, partLabel } from "../../shared/derive";
import { bulkMoveInstances, fetchPartFiles } from "../../shared/getters";
import type { PartFile } from "../../shared/types";
import { DownloadLink, formatInstanceRanges } from "../files/part-files-panel";

type FileGroup = { key: string; file: PartFile | null; rows: InstanceRow[] };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Groups rows by the file assigned to each instance; instances with no file group together. */
function groupByFile(rows: InstanceRow[], fileByInstance: Map<number, PartFile>): FileGroup[] {
  const map = new Map<string, FileGroup>();
  for (const r of rows) {
    const file = fileByInstance.get(r.instance.id) ?? null;
    const key = file ? String(file.id) : "none";
    const group = map.get(key) ?? { key, file, rows: [] };
    group.rows.push(r);
    map.set(key, group);
  }
  // Files by name, with the "no file" group last.
  return [...map.values()].sort((a, b) =>
    !a.file ? 1 : !b.file ? -1 : a.file.filename.localeCompare(b.file.filename),
  );
}

/**
 * Shop-floor view for a File Consumer process: work moves one file at a time. To Do and In
 * Progress are grouped by file, each with a download; start a file's instances together, then
 * complete them together.
 */
export function ConsumerSections({
  processId,
  rows,
  touch,
  onChanged,
}: {
  processId: number;
  rows: InstanceRow[];
  touch: boolean;
  onChanged: () => Promise<void>;
}) {
  const [files, setFiles] = useState<PartFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    try {
      setFiles(await fetchPartFiles());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files.");
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const fileByInstance = useMemo(() => {
    const map = new Map<number, PartFile>();
    for (const f of files) for (const a of f.assignments) map.set(a.partInstanceId, f);
    return map;
  }, [files]);

  const atThisStep = (status: "todo" | "doing") =>
    rows.filter((r) => r.current?.processId === processId && r.current.status === status);
  const todo = groupByFile(atThisStep("todo"), fileByInstance);
  const doing = groupByFile(atThisStep("doing"), fileByInstance);

  function move(group: FileGroup, to: "doing" | "done") {
    setBusy(true);
    setError(null);
    bulkMoveInstances(
      processId,
      group.rows.map((r) => r.instance.id),
      to,
    )
      .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong."))
      .finally(async () => {
        await Promise.all([onChanged(), loadFiles()]);
        setBusy(false);
      });
  }

  const btn = touch ? "px-4 py-2.5 text-sm" : "px-3 py-1.5 text-xs";

  const section = (
    title: string,
    groups: FileGroup[],
    empty: string,
    action: (group: FileGroup) => React.ReactNode,
  ) => (
    <section className="space-y-2">
      <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-secondary-400">
        {title}{" "}
        <span className="text-primary-600">{groups.reduce((n, g) => n + g.rows.length, 0)}</span>
      </h2>
      {groups.length === 0 ? (
        <p className="text-secondary-400 text-sm">{empty}</p>
      ) : (
        <div className="bg-surface border border-secondary-200 rounded-xl divide-y divide-secondary-200">
          {groups.map((group) => (
            <FileGroupBlock key={group.key} group={group} touch={touch}>
              {group.file && <DownloadLink file={group.file} />}
              {action(group)}
            </FileGroupBlock>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      {error && <ErrorBanner message={error} />}

      {section("In Progress", doing, "Nothing in progress here.", (group) => (
        <span className="relative group">
          <button
            type="button"
            disabled={busy}
            onClick={() => move(group, "done")}
            className={`${btn} font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50`}
          >
            Mark all complete
          </button>
          <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 hidden group-hover:block whitespace-nowrap bg-secondary-900 text-surface text-xs rounded-md px-2.5 py-1.5 shadow-lg">
            Do a quality check before marking these complete!
          </span>
        </span>
      ))}

      {section("To Do", todo, "Nothing ready to start.", (group) => (
        <Button size={touch ? "md" : "sm"} disabled={busy} onClick={() => move(group, "doing")}>
          Start all
        </Button>
      ))}
    </>
  );
}

/** A file header (name + actions) with one thin row per part it covers here. */
function FileGroupBlock({
  group,
  touch,
  children,
}: {
  group: FileGroup;
  touch: boolean;
  children: React.ReactNode;
}) {
  const byPart = new Map<number, InstanceRow[]>();
  for (const r of group.rows) {
    byPart.set(r.definition.id, [...(byPart.get(r.definition.id) ?? []), r]);
  }
  return (
    <div className={`px-4 ${touch ? "py-3" : "py-2.5"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex-1 min-w-0">
          {group.file ? (
            <p
              className="text-sm font-semibold text-secondary-900 truncate"
              title={group.file.filename}
            >
              {group.file.filename}
            </p>
          ) : (
            <p className="text-sm font-semibold text-amber-800">No file assigned</p>
          )}
          <p className="text-xs text-secondary-400">{plural(group.rows.length, "instance")}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">{children}</div>
      </div>
      <ul className="mt-1.5 ml-2 border-l-2 border-secondary-200">
        {[...byPart.values()].map((list) => (
          <li
            key={list[0].definition.id}
            className={`flex items-center gap-2 pl-3 pr-1 text-xs ${touch ? "py-1.5" : "py-0.5"}`}
          >
            <span className="text-secondary-900 truncate">{list[0].definition.name}</span>
            <span className="font-mono text-secondary-400 shrink-0">{partLabel(list[0])}</span>
            <span className="font-mono text-secondary-500 shrink-0">
              {formatInstanceRanges(list.map((r) => r.instance.instanceNumber))}
            </span>
            {list.some((r) => r.instance.isPriority) && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-300 rounded px-1 shrink-0">
                Priority
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
