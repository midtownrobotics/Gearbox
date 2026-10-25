import { Button, ErrorBanner, Loading, TextField, inputClass } from "@g3/ui";
import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { type StatusLevel, useRefreshAuthUser } from "../../shared/use-auth";

const MAX_LEVELS = 10;
const MAX_LABEL = 40;

/** A status being edited: its limit as typed, so the box can be emptied while typing. */
type Draft = { label: string; below: string };

const toDraft = (levels: StatusLevel[]): Draft[] =>
  levels.map((l) => ({ label: l.label, below: l.below === null ? "" : String(l.below) }));

/**
 * The words the Overview shows for how full the queue is, and the queue length each starts at.
 * The last one has no limit.
 */
export function StatusLevelsSettings() {
  const refreshAuth = useRefreshAuthUser();
  const [saved, setSaved] = useState<StatusLevel[] | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await api.admin["shop-status"].$get();
      if (!res.ok) return setError(await getErrorMessage(res as unknown as Response));
      const { levels } = await res.json();
      setSaved(levels);
      setRows(toDraft(levels));
    })();
  }, []);

  if (error && !saved) return <ErrorBanner message={error} />;
  if (!saved) return <Loading />;

  const levels: StatusLevel[] = rows.map((r, i) => ({
    label: r.label.trim(),
    below: i === rows.length - 1 ? null : Number(r.below),
  }));
  const changed = JSON.stringify(levels) !== JSON.stringify(saved);
  // Where each status starts: 0, then the limit of the one before.
  const from = (i: number) => (i === 0 ? "0" : rows[i - 1].below || "?");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.admin["shop-status"].$put({ json: { levels } });
      if (!res.ok) throw new Error(await getErrorMessage(res as unknown as Response));
      const next = (await res.json()).levels;
      setSaved(next);
      setRows(toDraft(next));
      refreshAuth();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The statuses didn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-secondary-500">
        What the Overview calls the shop for how many parts are in the queue.
      </p>
      <div className="space-y-2 max-w-xl">
        {rows.map((row, i) => {
          const last = i === rows.length - 1;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the index is the row
            <div key={i} className="flex flex-wrap items-center gap-2">
              <TextField
                kind="shopStatus"
                aria-label={`Status ${i + 1}`}
                value={row.label}
                maxLength={MAX_LABEL}
                disabled={busy}
                className="flex-1 min-w-40"
                onChange={(e) =>
                  setRows(rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))
                }
              />
              <span className="text-sm text-secondary-500 tabular-nums whitespace-nowrap">
                {from(i)}
                {last ? " or more parts" : " to under"}
              </span>
              {!last && (
                <TextField
                  variant="plain"
                  typeable
                  inputMode="numeric"
                  aria-label={`Where status ${i + 2} starts`}
                  value={row.below}
                  disabled={busy}
                  className={`${inputClass} !w-20`}
                  onChange={(e) => {
                    if (/^\d{0,4}$/.test(e.target.value))
                      setRows(rows.map((r, j) => (j === i ? { ...r, below: e.target.value } : r)));
                  }}
                />
              )}
              <button
                type="button"
                disabled={busy || rows.length === 1}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                aria-label={`Remove status ${i + 1}`}
                title="Remove this status"
                className="text-secondary-500 hover:text-red-600 px-1 transition-colors disabled:opacity-50"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={busy || rows.length >= MAX_LEVELS}
          onClick={() => {
            // The new one goes last; the one that was last gets a limit past where it starts.
            const prev = rows.length > 1 ? Number(rows[rows.length - 2].below) || 0 : 0;
            setRows([
              ...rows.slice(0, -1),
              { ...rows[rows.length - 1], below: String(prev + 10) },
              { label: "", below: "" },
            ]);
          }}
        >
          Add a status
        </Button>
        <Button disabled={busy || !changed} onClick={save}>
          {busy ? "Saving…" : "Save statuses"}
        </Button>
        {changed && !busy && (
          <Button variant="secondary" onClick={() => setRows(toDraft(saved))}>
            Undo changes
          </Button>
        )}
      </div>
    </div>
  );
}
