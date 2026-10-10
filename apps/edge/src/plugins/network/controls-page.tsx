import { useState } from "react";
import { Link } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { formatUntil } from "../../shared/format";
import { Toggle } from "../../shared/toggle";
import { Card, ErrorBanner, Loading, Page } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";

async function loadControls() {
  const res = await api.network.control.$get();
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

type Controls = Awaited<ReturnType<typeof loadControls>>;
type Blocklist = Controls["blocklists"][number];

/** Runs a mutation; returns an error message or null. */
async function mutate(
  run: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
) {
  const res = await run();
  return res.ok ? null : getErrorMessage(res);
}

const button = "text-sm font-medium rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50";
const primaryButton = `${button} bg-primary-500 hover:bg-primary-600 text-white`;
const plainButton = `${button} text-secondary-600 hover:text-secondary-900 hover:bg-secondary-100`;

export function ControlsPage() {
  const { data, error, reload } = useLoad(loadControls, []);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (error)
    return (
      <Page title="Controls">
        <ErrorBanner message={error} />
      </Page>
    );
  if (!data)
    return (
      <Page title="Controls">
        <Loading />
      </Page>
    );

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setActionError(await fn());
    setBusy(false);
    reload();
  }

  return (
    <Page
      title="Controls"
      actions={
        <SyncBadge
          data={data}
          onResend={() => run(() => mutate(() => api.network.control.sync.$post()))}
        />
      }
    >
      {actionError && <ErrorBanner message={actionError} />}

      <Card>
        <div className="space-y-4">
          <Toggle
            label="Enforce blocklists"
            description="Block or throttle sites in the enabled lists, except on devices with an exception."
            checked={data.enforce}
            disabled={busy}
            onChange={(enforce) =>
              run(() => mutate(() => api.network.control.settings.$patch({ json: { enforce } })))
            }
          />
          <Toggle
            label="DNS hardening"
            description="Stop devices getting around blocklists with encrypted DNS or iCloud Private Relay."
            checked={data.dnsHardening}
            disabled={busy}
            onChange={(dnsHardening) =>
              run(() =>
                mutate(() => api.network.control.settings.$patch({ json: { dnsHardening } })),
              )
            }
          />
        </div>
      </Card>

      <Blocklists lists={data.blocklists} onChanged={reload} />

      <Card title="Active exceptions">
        {data.grants.length === 0 ? (
          <p className="text-sm text-secondary-400">
            None. Give a device an exception from its page under{" "}
            <Link to="/network/clients" className="text-primary-500 hover:text-primary-700">
              Clients
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-secondary-100">
            {data.grants.map((g) => (
              <li key={g.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link
                  to={`/network/clients/${encodeURIComponent(g.mac)}`}
                  className="font-medium text-secondary-900 hover:text-primary-500"
                >
                  {g.clientName}
                </Link>
                <span className="text-sm text-secondary-600">{g.blocklistName ?? "All lists"}</span>
                <span className="text-sm text-secondary-500">
                  {formatUntil(g.expiresAt, data.now)}
                </span>
                <span className="text-xs text-secondary-400 flex-1 truncate">
                  {g.reason ? `“${g.reason}” · ` : ""}by {g.createdByName}
                </span>
                <button
                  type="button"
                  className={plainButton}
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      mutate(() =>
                        api.network.control.grants[":id"].$delete({ param: { id: String(g.id) } }),
                      ),
                    )
                  }
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}

/** Whether the box has applied the latest changes. */
function SyncBadge({ data, onResend }: { data: Controls; onResend: () => void }) {
  const pending = data.appliedStateVersion < data.stateVersion;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`w-2 h-2 rounded-full ${pending ? "bg-amber-400" : "bg-emerald-500"}`}
        aria-hidden
      />
      <span className="text-secondary-600">
        {pending ? "Changes pending on the box" : "Applied on the box"}
      </span>
      {pending && (
        <button type="button" className={plainButton} onClick={onResend}>
          Resend
        </button>
      )}
    </div>
  );
}

function Blocklists({ lists, onChanged }: { lists: Blocklist[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  return (
    <Card title="Blocklists">
      <div className="space-y-3">
        {lists.length === 0 && editing !== "new" && (
          <p className="text-sm text-secondary-400">
            No blocklists yet. A list is a set of domains to block or throttle.
          </p>
        )}
        {lists.map((l) =>
          editing === l.id ? (
            <BlocklistForm
              key={l.id}
              list={l}
              onDone={() => {
                setEditing(null);
                onChanged();
              }}
            />
          ) : (
            <div
              key={l.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-secondary-200 rounded-lg px-3 py-2"
            >
              <span
                className={`font-medium ${l.enabled ? "text-secondary-900" : "text-secondary-400 line-through"}`}
              >
                {l.name}
              </span>
              <span className="text-sm text-secondary-600">
                {l.action === "block"
                  ? "Blocked"
                  : `Throttled to ${((l.rateKbps ?? 0) / 1000).toFixed(1)} Mbit/s`}
              </span>
              <span className="text-sm text-secondary-400 flex-1">
                {l.domains.length} domain{l.domains.length === 1 ? "" : "s"}
                {!l.enabled && " · disabled"}
              </span>
              <button type="button" className={plainButton} onClick={() => setEditing(l.id)}>
                Edit
              </button>
            </div>
          ),
        )}
        {editing === "new" ? (
          <BlocklistForm
            onDone={() => {
              setEditing(null);
              onChanged();
            }}
          />
        ) : (
          <button type="button" className={primaryButton} onClick={() => setEditing("new")}>
            New blocklist
          </button>
        )}
      </div>
    </Card>
  );
}

function BlocklistForm({ list, onDone }: { list?: Blocklist; onDone: () => void }) {
  const [name, setName] = useState(list?.name ?? "");
  const [action, setAction] = useState<"block" | "throttle">(list?.action ?? "block");
  const [rateMbps, setRateMbps] = useState(String((list?.rateKbps ?? 1500) / 1000));
  const [enabled, setEnabled] = useState(list?.enabled ?? true);
  const [domains, setDomains] = useState(list?.domains.join("\n") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const json = {
      name,
      action,
      rateKbps: action === "throttle" ? Math.round(Number(rateMbps) * 1000) : null,
      enabled,
      domains: domains.split(/[\s,]+/).filter(Boolean),
    };
    const err = await mutate(() =>
      list
        ? api.network.control.blocklists[":id"].$put({ param: { id: String(list.id) }, json })
        : api.network.control.blocklists.$post({ json }),
    );
    setSaving(false);
    if (err) setError(err);
    else onDone();
  }

  async function remove() {
    if (!list || !window.confirm(`Delete the "${list.name}" blocklist and its exceptions?`)) return;
    setSaving(true);
    const err = await mutate(() =>
      api.network.control.blocklists[":id"].$delete({ param: { id: String(list.id) } }),
    );
    setSaving(false);
    if (err) setError(err);
    else onDone();
  }

  const input = "border border-secondary-300 rounded-lg px-2 py-1 text-sm";
  return (
    <form
      className="border border-primary-200 bg-primary-50/40 rounded-lg p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <input
          className={`${input} w-48`}
          value={name}
          maxLength={40}
          placeholder="Name, e.g. Video"
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className={input}
          value={action}
          onChange={(e) => setAction(e.target.value as "block" | "throttle")}
        >
          <option value="block">Block</option>
          <option value="throttle">Throttle</option>
        </select>
        {action === "throttle" && (
          <label className="flex items-center gap-1.5 text-sm text-secondary-600">
            to
            <input
              className={`${input} w-20`}
              type="number"
              min="0.1"
              max="100"
              step="0.1"
              value={rateMbps}
              onChange={(e) => setRateMbps(e.target.value)}
            />
            Mbit/s per device
          </label>
        )}
        <label className="flex items-center gap-1.5 text-sm text-secondary-600">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-widest text-secondary-400">
          Domains (one per line; includes subdomains)
        </span>
        <textarea
          className={`${input} mt-1 w-full h-32 font-mono`}
          value={domains}
          placeholder={"youtube.com\ngooglevideo.com"}
          onChange={(e) => setDomains(e.target.value)}
        />
      </label>
      {error && <ErrorBanner message={error} />}
      <div className="flex items-center gap-2">
        <button type="submit" className={primaryButton} disabled={saving}>
          Save
        </button>
        <button type="button" className={plainButton} onClick={onDone} disabled={saving}>
          Cancel
        </button>
        {list && (
          <button
            type="button"
            className={`${plainButton} ml-auto text-primary-600`}
            onClick={remove}
            disabled={saving}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
