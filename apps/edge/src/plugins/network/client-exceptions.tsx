import { useState } from "react";
import { Link } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { formatUntil } from "../../shared/format";
import { Card, ErrorBanner } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";

const DURATIONS = [
  { value: "1h", label: "1 hour" },
  { value: "4h", label: "4 hours" },
  { value: "today", label: "Rest of today" },
] as const;

/** Admin-only: time-limited exceptions to the blocklists for one device. */
export function ClientExceptions({ mac }: { mac: string }) {
  const user = useAuthUser();
  const { data, error, reload } = useLoad(async () => {
    if (!user.isAdmin) return null;
    const res = await api.network.control.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, [user.isAdmin]);
  const [blocklistId, setBlocklistId] = useState<string>("all");
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user.isAdmin) return null;
  if (error)
    return (
      <Card title="Exceptions">
        <ErrorBanner message={error} />
      </Card>
    );
  if (!data) return null;

  const grants = data.grants.filter((g) => g.mac === mac);

  async function run(fn: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>) {
    setBusy(true);
    const res = await fn();
    setActionError(res.ok ? null : await getErrorMessage(res));
    setBusy(false);
    reload();
  }

  const input = "border border-secondary-300 rounded-lg px-2 py-1 text-sm";
  return (
    <Card title="Exceptions">
      {!data.enforce && (
        <p className="text-sm text-secondary-500 mb-3">
          Blocklists aren't being enforced right now (see{" "}
          <Link to="/network/controls" className="text-primary-500 hover:text-primary-700">
            Controls
          </Link>
          ), so exceptions have no effect until they are.
        </p>
      )}
      {data.blocklists.length === 0 ? (
        <p className="text-sm text-secondary-400">No blocklists to make exceptions to.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-secondary-600">Allow</span>
          <select
            className={input}
            value={blocklistId}
            onChange={(e) => setBlocklistId(e.target.value)}
          >
            <option value="all">all lists</option>
            {data.blocklists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <input
            className={`${input} w-56`}
            value={reason}
            maxLength={200}
            placeholder="Reason (optional)"
            onChange={(e) => setReason(e.target.value)}
          />
          {DURATIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              disabled={busy}
              className="text-sm font-medium rounded-lg px-3 py-1.5 bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-50"
              onClick={() =>
                run(() =>
                  api.network.control.grants.$post({
                    json: {
                      mac,
                      blocklistId: blocklistId === "all" ? null : Number(blocklistId),
                      duration: d.value,
                      reason: reason || null,
                    },
                  }),
                )
              }
            >
              {d.label}
            </button>
          ))}
        </div>
      )}
      {actionError && (
        <div className="mt-3">
          <ErrorBanner message={actionError} />
        </div>
      )}
      {grants.length > 0 && (
        <ul className="mt-4 divide-y divide-secondary-100">
          {grants.map((g) => (
            <li key={g.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-secondary-900">
                {g.blocklistName ?? "All lists"}
              </span>
              <span className="text-sm text-secondary-500">
                {formatUntil(g.expiresAt, data.now)}
              </span>
              <span className="text-xs text-secondary-400 flex-1 truncate">
                {g.reason ? `“${g.reason}” · ` : ""}by {g.createdByName}
              </span>
              <button
                type="button"
                disabled={busy}
                className="text-sm font-medium rounded-lg px-3 py-1.5 text-secondary-600 hover:text-secondary-900 hover:bg-secondary-100"
                onClick={() =>
                  run(() =>
                    api.network.control.grants[":id"].$delete({ param: { id: String(g.id) } }),
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
  );
}
