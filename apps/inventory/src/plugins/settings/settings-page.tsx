import type { Setup, SetupSummary } from "@g3/worker-inventory";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { count } from "../../shared/format";
import { useInventory } from "../../shared/inventory-data";
import type { Named } from "../../shared/places";
import { Button, Card, ErrorBanner, Page, SuccessBanner, inputClass } from "../../shared/ui";
import { FieldsCard } from "./fields-card";
import { LocationsCard } from "./locations-card";

const smallButton = "text-xs text-secondary-500 hover:text-primary-600 disabled:opacity-50";

/** A plain list of names: the robots, or the subsystems, parts can be in use on. */
function NamesCard({
  title,
  about,
  what,
  rows,
  client,
}: {
  title: string;
  about: string;
  /** "robot", "subsystem" */
  what: string;
  rows: Named[];
  client: typeof api.robots | typeof api.subsystems;
}) {
  const { reload } = useInventory();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(
    request: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
  ) {
    setBusy(true);
    setError(null);
    try {
      const res = await request();
      if (!res.ok) return setError(await getErrorMessage(res));
      await reload();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (await send(() => client.$post({ json: { name: name.trim() } }))) setName("");
  }

  // Renaming and deleting are asked for in the row itself, not with the browser's own prompt and
  // confirm boxes, which embedded browsers don't show.
  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const next = editing.name.trim();
    if (!next || next === rows.find((row) => row.id === editing.id)?.name) return setEditing(null);
    const param = { id: String(editing.id) };
    if (await send(() => client[":id"].$patch({ param, json: { name: next } }))) setEditing(null);
  }

  async function remove(row: Named) {
    await send(() => client[":id"].$delete({ param: { id: String(row.id) } }));
    setDeleting(null);
  }

  return (
    <Card title={title}>
      <p className="mb-3 text-sm text-secondary-500">{about}</p>
      {rows.length > 0 && (
        <ul className="mb-3 divide-y divide-secondary-100">
          {rows.map((row) => (
            <li key={row.id} className="py-1.5">
              {editing?.id === row.id ? (
                <form onSubmit={rename} className="flex gap-2">
                  <input
                    className={inputClass}
                    aria-label={`New name for ${row.name}`}
                    maxLength={80}
                    value={editing.name}
                    onChange={(e) => setEditing({ id: row.id, name: e.target.value })}
                  />
                  <Button type="submit" variant="secondary" disabled={busy || !editing.name.trim()}>
                    Save
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </form>
              ) : deleting === row.id ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm text-primary-700">
                    Delete the {what} “{row.name}”?
                  </span>
                  <button
                    type="button"
                    className={smallButton}
                    disabled={busy}
                    onClick={() => void remove(row)}
                  >
                    Yes, delete
                  </button>
                  <button
                    type="button"
                    className={smallButton}
                    disabled={busy}
                    onClick={() => setDeleting(null)}
                  >
                    Keep it
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm text-secondary-900">{row.name}</span>
                  <button
                    type="button"
                    className={smallButton}
                    disabled={busy}
                    onClick={() => {
                      setDeleting(null);
                      setEditing({ id: row.id, name: row.name });
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className={smallButton}
                    disabled={busy}
                    onClick={() => {
                      setEditing(null);
                      setDeleting(row.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2">
        <input
          className={inputClass}
          placeholder={`New ${what}`}
          aria-label={`New ${what}`}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={busy || !name.trim()}>
          Add
        </Button>
      </form>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
    </Card>
  );
}

/** A file about to be loaded, and what loading it would add. */
type Pending = { label: string; file: Setup; summary: SetupSummary };

/** "2 fields, 14 locations" for what a summary adds; "" for nothing. */
function addsLine(summary: SetupSummary): string {
  return [
    summary.fields > 0 && count(summary.fields, "field"),
    summary.choices > 0 && `${count(summary.choices, "choice")} on fields you have`,
    summary.locations > 0 && count(summary.locations, "location"),
    summary.robots > 0 && count(summary.robots, "robot"),
    summary.subsystems > 0 && count(summary.subsystems, "subsystem"),
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The team's arrangement as one file: save it to keep a copy or share it, and load a file (the
 * team's own, another team's, or the starter that comes with the app). Loading only adds what's
 * missing, and its effect is shown first.
 */
function SetupCard() {
  const { reload } = useInventory();
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

  /** Shows what the server says is wrong with a file it refuses. */
  async function refused(res: { status: number; json(): Promise<unknown> }) {
    if (res.status === 400) {
      const body = (await res.json()) as { error?: string; problems?: string[] };
      setError(body.error ?? "This file can't be loaded.");
      setProblems(body.problems ?? []);
    } else {
      setError(await getErrorMessage(res));
    }
  }

  async function preview(label: string, file: Setup) {
    const res = await api.setup.preview.$post({ json: file });
    if (!res.ok) return refused(res);
    setPending({ label, file, summary: await res.json() });
  }

  function save() {
    reset();
    void attempt(async () => {
      const res = await api.setup.export.$get();
      if (!res.ok) return setError(await getErrorMessage(res));
      const blob = new Blob([JSON.stringify(await res.json(), null, 2)], {
        type: "application/json",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "inventory-setup.json";
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
      let contents: Setup;
      try {
        contents = JSON.parse(await file.text());
      } catch {
        return setError(`“${file.name}” isn't an Inventory setup file.`);
      }
      await preview(`“${file.name}”`, contents);
    });
  }

  function chooseStarter() {
    reset();
    void attempt(async () => {
      const res = await api.setup.starter.$get();
      if (!res.ok) return setError(await getErrorMessage(res));
      await preview("The starter setup", await res.json());
    });
  }

  function load(chosen: Pending) {
    void attempt(async () => {
      const res = await api.setup.import.$post({ json: chosen.file });
      if (!res.ok) return refused(res);
      const added = addsLine(await res.json());
      await reload();
      reset();
      setDone(added ? `Added ${added}.` : "Nothing to add: you already have all of it.");
    });
  }

  return (
    <Card title="Setup file">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={save}>
          Save to a file
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
          Load a file…
        </Button>
        <Button variant="secondary" disabled={busy} onClick={chooseStarter}>
          Load the starter setup
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Inventory setup file"
          onChange={chooseFile}
        />
      </div>
      <p className="mt-3 text-sm text-secondary-500">
        Your fields, locations, robots and subsystems as one file, without your parts. Loading a
        file only adds what's missing.
      </p>

      {pending && (
        <div className="mt-4 rounded-lg border border-secondary-200 bg-secondary-50 p-4">
          <p className="font-semibold text-secondary-900">Load {pending.label}?</p>
          <p className="mt-1 text-sm text-secondary-700">
            {addsLine(pending.summary)
              ? `It adds ${addsLine(pending.summary)}.`
              : "It adds nothing: you already have all of it."}
            {pending.summary.already > 0 &&
              ` ${count(pending.summary.already, "thing")} in it ${
                pending.summary.already === 1 ? "is" : "are"
              } already here.`}
          </p>
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

/** How the team has Inventory arranged. Admins only. */
export function SettingsPage() {
  const { isAdmin } = useAuthUser();
  const { places } = useInventory();
  if (!isAdmin) {
    return (
      <Page title="Settings">
        <ErrorBanner message="Only admins can change Inventory's settings." />
      </Page>
    );
  }
  return (
    <Page title="Settings">
      <SetupCard />
      <LocationsCard />
      <FieldsCard />
      <div className="grid gap-5 md:grid-cols-2">
        <NamesCard
          title="Robots"
          about="Robots that parts can be in use on."
          what="robot"
          rows={places.robots}
          client={api.robots}
        />
        <NamesCard
          title="Subsystems"
          about="The part of a robot that parts in use are on."
          what="subsystem"
          rows={places.subsystems}
          client={api.subsystems}
        />
      </div>
    </Page>
  );
}
