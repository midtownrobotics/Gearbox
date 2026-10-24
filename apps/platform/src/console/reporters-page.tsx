import {
  Button,
  Card,
  ConfirmButton,
  ConfirmQuestion,
  ErrorBanner,
  Field,
  Page,
  TextField,
} from "@g3/ui";
import { useState } from "react";
import { type BlockedReporter, consoleApi, formatDate, read, send, useLoad } from "./data";

// Blocking reporters by the reporter ID on a problem report's GitHub issue. The console shows a
// blocked reporter's team number (it's on their issues too), never who they are; a blocked one can't send reports, and their team's admins
// are told on their chat who it is and why.

/** A reporter ID: 10 hex digits (src/reports.ts on the platform worker). */
const REPORTER_ID = /^[0-9a-f]{10}$/;

export function ReportersPage() {
  const blocked = useLoad(() => read<BlockedReporter[]>(consoleApi.reporters.$get()), []);
  const [id, setId] = useState("");
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reporterId = id.trim().toLowerCase();
  const idLooksWrong = reporterId !== "" && !REPORTER_ID.test(reporterId);

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

  function block() {
    run(async () => {
      await send("POST", `/reporters/${encodeURIComponent(reporterId)}`, {
        blocked: true,
        reason: reason.trim(),
      });
      setId("");
      setReason("");
      setAsking(false);
    });
  }

  return (
    <Page
      title="Reporters"
      description="Block someone who sends spam or misuses Report a problem, by the reporter ID on their GitHub issue. You won't see who they are; their team's admins are told who it is and your reason."
    >
      {blocked.error && <ErrorBanner message={blocked.error} />}
      <Card title="Block a reporter">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setAsking(true);
          }}
        >
          <div className="max-w-xs">
            <Field
              label="Reporter ID"
              hint={
                idLooksWrong
                  ? "A reporter ID is 10 letters and numbers, like 0eae4c29a5."
                  : "In the Reporter row of the issue's table."
              }
              warn={idLooksWrong}
            >
              <TextField
                kind="label"
                required
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setAsking(false);
                }}
                placeholder="0eae4c29a5"
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
          </div>
          <Field label="Reason" hint="Kept in the log and sent to the team's admins.">
            <TextField
              multiline
              kind="reason"
              required
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What they sent, and why it's misuse"
            />
          </Field>
          {error && <ErrorBanner message={error} />}
          {asking ? (
            <ConfirmQuestion
              question={`Block reporter ${reporterId}? They can't send reports until they're unblocked, and their team's admins are told.`}
              confirmLabel={busy ? "Blocking…" : "Block"}
              keepLabel="Cancel"
              disabled={busy}
              onConfirm={block}
              onKeep={() => setAsking(false)}
            />
          ) : (
            <Button
              type="submit"
              variant="danger"
              disabled={!REPORTER_ID.test(reporterId) || !reason.trim()}
            >
              Block
            </Button>
          )}
        </form>
      </Card>
      <Card title="Blocked">
        {blocked.data?.length === 0 ? (
          <p className="text-sm text-secondary-500">Nobody is blocked.</p>
        ) : (
          <ul className="divide-y divide-line">
            {blocked.data?.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
                    <span className="font-mono font-medium text-secondary-900">{r.id}</span>
                    <span className="text-secondary-600">Team {r.teamNumber}</span>
                  </p>
                  {r.blockReason && (
                    <p className="text-sm break-words text-secondary-700">{r.blockReason}</p>
                  )}
                  <p className="text-xs text-secondary-500">
                    Blocked by {r.blockedByName} on {formatDate(r.blockedAt)}
                  </p>
                </div>
                <ConfirmButton
                  size="sm"
                  label="Unblock"
                  question={`Unblock reporter ${r.id}? Their team's admins are told.`}
                  onConfirm={() =>
                    run(() => send("POST", `/reporters/${r.id}`, { blocked: false }))
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
