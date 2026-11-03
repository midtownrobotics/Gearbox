// SPDX-License-Identifier: AGPL-3.0-only
import { apiPath } from "@g3/site-config";
import { Button, Card, ConfirmButton, ErrorBanner, Loading, Page, Switch, TextField } from "@g3/ui";
import { useEffect, useState } from "react";
import { g3id } from "../../lib/api";

// The team's subteams (G3ID's /admin/team/subteams, through /api/~id): on or off, and their
// names. Members choose one when they join and on their Account page; admins change a member's on
// their page in Members.

type Subteam = { id: string; name: string; members: number };
type State = { enabled: boolean; subteams: Subteam[] };

const people = (n: number) => (n === 1 ? "1 member" : `${n} members`);

/** Sends a change and answers with the page's new state, or throws what went wrong. */
async function send(path: string, method: string, body?: unknown): Promise<State> {
  const res = await fetch(`${apiPath("id")}/admin/team/subteams${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as State & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "That didn't work. Try again.");
  return data;
}

/** One subteam: its name (Rename), how many are in it, and Delete. */
function SubteamItem({
  subteam,
  busy,
  run,
}: {
  subteam: Subteam;
  busy: boolean;
  run: (change: () => Promise<State>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => send(`/${subteam.id}`, "PUT", { name: draft }))) setDraft(null);
        }}
      >
        <TextField
          kind="subteam"
          autoFocus
          maxLength={40}
          value={draft}
          aria-label="Subteam name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setDraft(null)}
          disabled={busy}
          className="min-w-0 flex-1"
          required
        />
        <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => setDraft(null)}
        >
          Cancel
        </Button>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="font-medium text-secondary-900">{subteam.name}</p>
        <p className="text-xs text-secondary-500">{people(subteam.members)}</p>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => setDraft(subteam.name)}
        >
          Rename
        </Button>
        <ConfirmButton
          size="sm"
          label="Delete"
          confirmLabel="Delete"
          question={
            subteam.members > 0
              ? `Delete ${subteam.name}? Its ${people(subteam.members)} will be in no subteam.`
              : `Delete ${subteam.name}?`
          }
          disabled={busy}
          onConfirm={() => void run(() => send(`/${subteam.id}`, "DELETE"))}
        />
      </div>
    </div>
  );
}

export function SubteamsPage() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    g3id.admin.team.subteams
      .$get()
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setState((await res.json()) as State);
      })
      .catch(() => setError("Couldn't load your team's subteams."));
  }, []);

  /** Runs a change; true when it worked. */
  async function run(change: () => Promise<State>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      setState(await change());
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Subteams"
      description="Split your team into subteams, like Programming or Mechanical. Members choose theirs when they join and can change it on their Account page."
      width="narrow"
    >
      {error && <ErrorBanner message={error} />}
      {!state && !error && <Loading />}
      {state && (
        <>
          <Card className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-secondary-900">Use subteams</h2>
              <p className="text-sm text-secondary-600">
                Off, nobody is asked for a subteam. Who's in which is kept for when you switch them
                on again.
              </p>
            </div>
            <Switch
              checked={state.enabled}
              label={`Subteams ${state.enabled ? "on" : "off"}`}
              disabled={busy}
              onChange={(enabled) => void run(() => send("", "PUT", { enabled }))}
            />
          </Card>

          <Card title="Your subteams">
            {state.subteams.length === 0 ? (
              <p className="text-sm text-secondary-500">No subteams yet. Add your first below.</p>
            ) : (
              <ul className="divide-y divide-secondary-200">
                {state.subteams.map((subteam) => (
                  <li key={subteam.id} className="py-3 first:pt-0">
                    <SubteamItem subteam={subteam} busy={busy} run={run} />
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-4 flex flex-wrap gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run(() => send("", "POST", { name }))) setName("");
              }}
            >
              <TextField
                kind="subteam"
                maxLength={40}
                placeholder="New subteam"
                aria-label="New subteam name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                className="min-w-0 flex-1"
              />
              <Button type="submit" disabled={busy || !name.trim()}>
                Add
              </Button>
            </form>
          </Card>
        </>
      )}
    </Page>
  );
}
