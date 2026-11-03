// SPDX-License-Identifier: AGPL-3.0-only
import {
  Button,
  Card,
  Dialog,
  ErrorBanner,
  Page,
  PageLoading,
  TextField,
  inputClass,
} from "@g3/ui";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  type MemberCounts,
  type MemberList,
  type TeamDetail,
  chatName,
  consoleApi,
  formatDate,
  formatTime,
  read,
  send,
  useLoad,
} from "./data";
import { ActionList } from "./log-page";
import { ReportCard } from "./reports-page";
import { StatusBadge } from "./shell";

// One team: its details and how many members it has, the reports against its number, what
// operators have done to it, and the tools for a number claimed wrongly (hand it over, suspend,
// delete; a wrong number is deleted and signed up again). Its members' names and emails are only
// shown once the operator opens the member list with a reason, which the team's admins see;
// handing it over needs the list.

export function TeamPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const detail = useLoad(
    () => read<TeamDetail>(consoleApi.teams[":id"].$get({ param: { id } })),
    [id],
  );

  const back = (
    <Link to="/console" className="text-sm text-secondary-500 hover:text-primary-600">
      ← All teams
    </Link>
  );
  if (detail.error) {
    return (
      <Page title="Team" actions={back}>
        <ErrorBanner message={detail.error} />
      </Page>
    );
  }
  if (!detail.data) return <PageLoading />;
  const { team, members, reports, actions } = detail.data;

  return (
    <Page
      title={`${team.teamNumber} · ${team.name}`}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={team.status} />
          {team.isSite && "The site's own team"}
        </span>
      }
      actions={back}
    >
      <Card title="Details">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Detail label="Members">{describeCounts(members)}</Detail>
          <Detail label="Chat">{chatName(team.chat)}</Detail>
          <Detail label="Country">{team.country}</Detail>
          <Detail label="Signed up">{formatTime(team.createdAt)}</Detail>
          <Detail label="Terms accepted">
            {formatTime(team.termsAcceptedAt)}
            {team.termsVersion && ` (version of ${team.termsVersion})`}
          </Detail>
        </dl>
      </Card>

      <Members
        teamId={team.id}
        canHandOver={team.status !== "pending"}
        hasOwner={team.hasOwner}
        onChange={detail.reload}
      />

      {reports.length > 0 && (
        <Card title="Reports about this number">
          <div className="space-y-3">
            {reports.map((r) => (
              <ReportCard key={r.id} report={r} onChange={detail.reload} />
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {!team.isSite && team.status !== "pending" && (
          <ActionForm
            title={team.status === "suspended" ? "Reactivate" : "Suspend"}
            description={
              team.status === "suspended"
                ? "Gives the team its addresses back."
                : "Takes the team's addresses away and keeps its data, while a report is looked into."
            }
            button={team.status === "suspended" ? "Reactivate" : "Suspend"}
            onSubmit={(reason) =>
              send("POST", `/teams/${team.id}/status`, {
                reason,
                status: team.status === "suspended" ? "active" : "suspended",
              }).then(detail.reload)
            }
          />
        )}
        {!team.isSite && (
          <Delete
            number={team.teamNumber}
            onSubmit={async (reason, confirmNumber) => {
              await send("DELETE", `/teams/${team.id}`, { reason, confirmNumber });
              navigate("/console", { replace: true });
            }}
          />
        )}
      </div>

      <Card title="Log">
        <ActionList actions={actions} showTeam={false} />
      </Card>
    </Page>
  );
}

function describeCounts(counts: MemberCounts | null): string {
  if (!counts) return "—";
  const roles = [
    counts.admins && `${counts.admins} admin${counts.admins === 1 ? "" : "s"}`,
    counts.mentors && `${counts.mentors} mentor${counts.mentors === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return [
    `${counts.active} active${roles.length ? ` (${roles.join(", ")})` : ""}`,
    counts.pending > 0 && `${counts.pending} waiting for approval`,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The team's member list: closed until the operator asks for it with a reason (the team's admins
 * see that it was opened, when and why), then the members and the hand-over tool.
 */
function Members({
  teamId,
  canHandOver,
  hasOwner,
  onChange,
}: {
  teamId: string;
  canHandOver: boolean;
  hasOwner: boolean;
  onChange: () => void;
}) {
  const [list, setList] = useState<MemberList | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!list) {
    return (
      <Card title="Members">
        <div className="space-y-3">
          <p className="text-sm text-secondary-600">
            Names and emails are hidden. Open the member list only when you need it, for example to
            hand the team over. The team's admins will see that it was opened, when, and your
            reason.
          </p>
          <Button variant="secondary" onClick={() => setAsking(true)}>
            Open member list
          </Button>
        </div>
        {asking && (
          <Dialog title="Open the member list?" onClose={() => setAsking(false)}>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  setList(
                    await send<MemberList>("POST", `/teams/${teamId}/members`, {
                      reason: reason.trim(),
                    }),
                  );
                  setAsking(false);
                  setReason("");
                  onChange();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="text-sm text-secondary-700">
                This shows the names and emails of the team's members. The team's admins will see on
                their Member Access page that a Gearbox operator opened it, when, and the reason you
                give. Each time you open it is logged.
              </p>
              <TextField
                multiline
                kind="reason"
                required
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why? (kept in the log, and shown to the team's admins)"
                aria-label="Reason"
              />
              {error && <ErrorBanner message={error} />}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setAsking(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  Open member list
                </Button>
              </div>
            </form>
          </Dialog>
        )}
      </Card>
    );
  }

  const { members, ownerUserId, founderUserId } = list;
  return (
    <>
      <Card title={`Members (${members.length})`}>
        <div className="relative overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-line first:border-0">
                  <td className="py-2 pr-4 text-secondary-900">
                    {m.displayName}
                    {m.id === ownerUserId && (
                      <span className="ml-2 text-xs font-semibold text-primary-600">owner</span>
                    )}
                    {m.id === founderUserId && (
                      <span className="ml-2 text-xs text-secondary-500">founder</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-secondary-600">{m.email}</td>
                  <td className="py-2 pr-4 text-secondary-600">
                    {[
                      m.isAdmin && "admin",
                      m.isMentor && "mentor",
                      m.status !== "active" && m.status,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </td>
                  <td className="py-2 text-secondary-500">Last in {formatDate(m.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {members.length === 0 && <p className="text-sm text-secondary-500">No accounts yet.</p>}
        </div>
      </Card>
      {canHandOver && (
        <TransferOwner
          list={list}
          hasOwner={hasOwner}
          send={(body) => send("POST", `/teams/${teamId}/owner`, body)}
          onDone={(userId) => {
            setList({ ...list, ownerUserId: userId });
            onChange();
          }}
        />
      )}
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-secondary-500">{label}</dt>
      <dd className="text-secondary-900">{children}</dd>
    </div>
  );
}

/**
 * A tool: its fields, the operator's reason (required, kept in the log) and its button. Shows the
 * error if it fails.
 */
function ActionForm({
  title,
  description,
  button,
  danger = false,
  children,
  onSubmit,
}: {
  title: string;
  description: string;
  button: string;
  danger?: boolean;
  children?: ReactNode;
  onSubmit: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title={title}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onSubmit(reason.trim());
            setReason("");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-secondary-600">{description}</p>
        {children}
        <TextField
          multiline
          kind="reason"
          required
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why? (kept in the log, and shown to the team's admins)"
          aria-label="Reason"
        />
        {error && <ErrorBanner message={error} />}
        <Button type="submit" disabled={busy} variant={danger ? "danger" : "primary"}>
          {button}
        </Button>
      </form>
    </Card>
  );
}

function TransferOwner({
  list,
  hasOwner,
  send,
  onDone,
}: {
  list: MemberList;
  hasOwner: boolean;
  send: (body: { reason: string; userId: string; keepPreviousAdmin: boolean }) => Promise<unknown>;
  onDone: (userId: string) => void;
}) {
  const owner = list.members.find((m) => m.id === list.ownerUserId);
  const others = list.members.filter((m) => m.id !== list.ownerUserId);
  const [userId, setUserId] = useState("");
  const [keepPreviousAdmin, setKeepPreviousAdmin] = useState(true);
  if (others.length === 0) return null;
  return (
    <ActionForm
      title="Hand over"
      description="Makes another member the team's owner and an admin."
      button="Hand over"
      onSubmit={async (reason) => {
        await send({ reason, userId, keepPreviousAdmin });
        onDone(userId);
        setUserId("");
      }}
    >
      <select
        required
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        className={`${inputClass} max-w-full`}
        aria-label="New owner"
      >
        <option value="">Choose a member</option>
        {others.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName} ({m.email})
          </option>
        ))}
      </select>
      {hasOwner && owner && (
        <label className="flex items-center gap-2 text-sm text-secondary-700">
          <input
            type="checkbox"
            checked={keepPreviousAdmin}
            onChange={(e) => setKeepPreviousAdmin(e.target.checked)}
          />
          Keep {owner.displayName} an admin
        </label>
      )}
    </ActionForm>
  );
}

function Delete({
  number,
  onSubmit,
}: {
  number: number;
  onSubmit: (reason: string, confirmNumber: number) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState("");
  return (
    <ActionForm
      title="Delete the team"
      description="Deletes the team for good: every account on it, their sign-ins, its kiosks and its Slack or Discord connection. The number is free again. This can't be undone."
      button="Delete for good"
      danger
      onSubmit={(reason) => onSubmit(reason, Number(confirm))}
    >
      <TextField
        kind="label"
        required
        inputMode="numeric"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={`Type ${number} to confirm`}
        aria-label="Team number, to confirm"
      />
    </ActionForm>
  );
}
