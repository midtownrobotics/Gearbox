import { Button, Card, ConfirmButton, ErrorBanner, Field, Page, TextField } from "@g3/ui";
import { useState } from "react";
import { type BlockedReporter, consoleApi, formatDate, read, send, useLoad } from "./data";

// Blocking reporters by the reporter ID on a problem report's GitHub issue. The console never
// shows who a reporter is or their team; a blocked one can't send reports, and their team's admins
// are told on their chat who it is and why.

export function ReportersPage() {
  const blocked = useLoad(() => read<BlockedReporter[]>(consoleApi.reporters.$get()), []);
  const [id, setId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await blocked.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Reporters"
      description="Block someone who misuses Report a problem, by the reporter ID on their GitHub issue. Their reports are refused. You don't learn who they are, but their team's admins are told who it is and your reason."
    >
      {(error ?? blocked.error) && <ErrorBanner message={error ?? blocked.error ?? ""} />}
      <Card title="Block a reporter">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await send("POST", `/reporters/${encodeURIComponent(id.trim())}`, {
                blocked: true,
                reason: reason.trim(),
              });
              setId("");
              setReason("");
            });
          }}
        >
          <Field label="Reporter ID">
            <TextField
              kind="label"
              required
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="From the issue's Reporter row"
              className="max-w-xs font-mono"
            />
          </Field>
          <Field label="Reason">
            <TextField
              multiline
              kind="reason"
              required
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why? (kept in the log, and sent to the team's admins)"
            />
          </Field>
          <Button type="submit" variant="danger" disabled={busy}>
            Block
          </Button>
        </form>
      </Card>
      <Card title="Blocked">
        {blocked.data?.length === 0 && (
          <p className="text-sm text-secondary-500">Nobody is blocked.</p>
        )}
        <ul className="divide-y divide-line text-sm">
          {blocked.data?.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className="font-mono font-medium text-secondary-900">{r.id}</span>
              <span className="text-secondary-600">“{r.blockReason}”</span>
              <span className="text-secondary-500">
                {r.blockedByName} · {formatDate(r.blockedAt)}
              </span>
              <span aria-hidden className="ml-auto" />
              <ConfirmButton
                size="sm"
                label="Unblock"
                question={`Unblock reporter ${r.id}?`}
                onConfirm={() => run(() => send("POST", `/reporters/${r.id}`, { blocked: false }))}
              />
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
