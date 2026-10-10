import type { LoadSummary, TreeSet } from "@g3/worker-skill-tree";
import { type ChangeEvent, useRef, useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { useSkillData } from "../../shared/skill-data";
import { Button, Card, ErrorBanner, SuccessBanner } from "../../shared/ui";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A file about to be loaded, and what loading it would change. */
type Pending = { label: string; file: unknown; summary: LoadSummary };

/** "9 trees (2 new, 1 removed)" */
function changeLine(change: LoadSummary["trees"], one: string, many = `${one}s`): string {
  const parts = [
    change.added > 0 ? `${change.added} new` : null,
    change.removed > 0 ? `${change.removed} removed` : null,
  ].filter(Boolean);
  return `${count(change.total, one, many)}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
}

/**
 * The team's trees as one set: save it to a file, or load a file (the team's own, or the default
 * set) in its place. A file is checked and its effect shown before anything changes.
 */
export function TreeSetCard() {
  const { treeSet, reloadTrees, reloadStudents } = useSkillData();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);

  function reset() {
    setPending(null);
    setError(null);
    setProblems([]);
    setDone(null);
  }

  /** Runs one step, showing what the server says is wrong with the file if it refuses it. */
  async function attempt(step: () => Promise<void>) {
    setBusy(true);
    try {
      await step();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function refused(res: { status: number; json(): Promise<unknown> }) {
    if (res.status === 400) {
      const body = (await res.json()) as { error?: string; problems?: string[] };
      setError(body.error ?? "This file can't be loaded.");
      setProblems(body.problems ?? []);
    } else {
      setError(await getErrorMessage(res));
    }
  }

  async function preview(label: string, file: unknown) {
    const res = await api.trees.import.preview.$post({ json: file as TreeSet });
    if (!res.ok) return refused(res);
    setPending({ label, file, summary: (await res.json()).summary });
  }

  function save() {
    reset();
    void attempt(async () => {
      const res = await api.trees.export.$get();
      if (!res.ok) return setError(await getErrorMessage(res));
      const blob = new Blob([JSON.stringify(await res.json(), null, 2)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "skill-trees.json";
      link.click();
      URL.revokeObjectURL(link.href);
    });
  }

  function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // So the same file can be chosen again after it's been fixed.
    e.target.value = "";
    if (!file) return;
    reset();
    void attempt(async () => {
      let contents: unknown;
      try {
        contents = JSON.parse(await file.text());
      } catch {
        return setError(`“${file.name}” isn't a skill trees file.`);
      }
      await preview(`“${file.name}”`, contents);
    });
  }

  function chooseDefault() {
    reset();
    void attempt(async () => {
      const res = await api.trees.default.$get();
      if (!res.ok) return setError(await getErrorMessage(res));
      await preview("The default set", await res.json());
    });
  }

  function load(chosen: Pending) {
    void attempt(async () => {
      const res = await api.trees.import.$post({ json: chosen.file as TreeSet });
      if (!res.ok) return refused(res);
      await Promise.all([reloadTrees(), reloadStudents()]);
      reset();
      setDone(`Loaded ${chosen.label.replace(/^The /, "the ")}.`);
    });
  }

  return (
    <Card title="Tree set">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-secondary-900">{treeSet.name}</p>
          <p className="text-xs text-secondary-500">
            {treeSet.loadedByName
              ? `Loaded by ${treeSet.loadedByName} on ${dateFormat.format(treeSet.loadedAt)}`
              : "The set every team starts with"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={save}>
            Save to a file
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
            Load a file…
          </Button>
          <Button variant="secondary" disabled={busy} onClick={chooseDefault}>
            Load the default set
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Skill trees file"
            onChange={chooseFile}
          />
        </div>
      </div>
      <p className="mt-3 text-sm text-secondary-500">
        Your team's trees as one file. Loading a file makes the trees match it; skills still in the
        file keep everyone's progress.
      </p>

      {pending && (
        <div className="mt-4 rounded-lg border border-secondary-200 bg-secondary-50 p-4">
          <p className="font-semibold text-secondary-900">Load {pending.label}?</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-secondary-700">
            <li>{changeLine(pending.summary.trees, "tree")}</li>
            <li>{changeLine(pending.summary.categories, "category", "categories")}</li>
            <li>{changeLine(pending.summary.skills, "skill")}</li>
          </ul>
          {pending.summary.skills.removed > 0 && (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Removed skills are deleted, along with{" "}
              {count(pending.summary.progressRemoved, "sign-off")} on them. This can't be undone.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => load(pending)}>
              {busy ? "Loading…" : "Load it"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2 empty:hidden">
        {error && <ErrorBanner message={error} />}
        {problems.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-secondary-700">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {done && <SuccessBanner message={done} />}
      </div>
    </Card>
  );
}
