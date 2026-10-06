import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { type TeamDetail, consoleApi, formatDate, formatTime, read, send, useLoad } from "./data";
import { ActionList } from "./log-page";
import { ReportCard } from "./reports-page";
import { Notice, Panel, StatusBadge, buttonClass, fieldClass } from "./shell";

// One team: its details and members, the reports against its number, what operators have done to
// it, and the tools for a number claimed wrongly (hand it over, renumber, suspend, delete).

export function TeamPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const detail = useLoad(
    () => read<TeamDetail>(consoleApi.teams[":id"].$get({ param: { id } })),
    [id],
  );

  if (detail.error) return <Notice>{detail.error}</Notice>;
  if (!detail.data) return null;
  const { team, members, reports, actions } = detail.data;

  return (
    <div className="space-y-5">
      <Link to="/console" className="text-sm text-secondary-500 hover:text-secondary-900">
        ← Teams
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-secondary-900">
          {team.teamNumber} · {team.name}
        </h1>
        <StatusBadge status={team.status} />
        {team.isSite && <span className="text-sm text-secondary-500">The site's own team</span>}
      </div>

      <Panel title="Details">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Field label="Owner">{team.owner?.name ?? "—"}</Field>
          <Field label="Founder">{team.founder?.name ?? "—"}</Field>
          <Field label="Slack workspace">{team.slackWorkspaceName ?? "—"}</Field>
          <Field label="Country">{team.country}</Field>
          <Field label="Signed up">{formatTime(team.createdAt)}</Field>
          <Field label="Terms accepted">{formatTime(team.termsAcceptedAt)}</Field>
        </dl>
      </Panel>

      <Panel title={`Members (${members.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-line first:border-0">
                  <td className="py-2 pr-4 text-secondary-900">
                    {m.displayName}
                    {m.id === team.owner?.id && (
                      <span className="ml-2 text-xs font-semibold text-primary-600">owner</span>
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
      </Panel>

      {reports.length > 0 && (
        <Panel title="Reports about this number">
          <div className="space-y-3">
            {reports.map((r) => (
              <ReportCard key={r.id} report={r} onChange={detail.reload} />
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {team.status !== "pending" && (
          <TransferOwner
            team={detail.data}
            onDone={detail.reload}
            send={(body) => send("POST", `/teams/${team.id}/owner`, body)}
          />
        )}
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
          <Renumber
            current={team.teamNumber}
            onSubmit={async (reason, teamNumber) => {
              const { id: newId } = await send<{ id: string }>(
                "POST",
                `/teams/${team.id}/renumber`,
                { reason, teamNumber },
              );
              navigate(`/console/teams/${newId}`, { replace: true });
            }}
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

      <Panel title="Log">
        <ActionList actions={actions} showTeam={false} />
      </Panel>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
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
    <Panel title={title}>
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
        <textarea
          required
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why? (kept in the log)"
          className={fieldClass}
        />
        {error && <Notice>{error}</Notice>}
        <button
          type="submit"
          disabled={busy}
          className={buttonClass(danger ? "danger" : "primary")}
        >
          {button}
        </button>
      </form>
    </Panel>
  );
}

function TransferOwner({
  team,
  send,
  onDone,
}: {
  team: TeamDetail;
  send: (body: { reason: string; userId: string; keepPreviousAdmin: boolean }) => Promise<unknown>;
  onDone: () => void;
}) {
  const others = team.members.filter((m) => m.id !== team.team.owner?.id);
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
        onDone();
      }}
    >
      <select
        required
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        className={fieldClass}
      >
        <option value="">Choose a member</option>
        {others.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName} ({m.email})
          </option>
        ))}
      </select>
      {team.team.owner && (
        <label className="flex items-center gap-2 text-sm text-secondary-700">
          <input
            type="checkbox"
            checked={keepPreviousAdmin}
            onChange={(e) => setKeepPreviousAdmin(e.target.checked)}
          />
          Keep {team.team.owner.name} an admin
        </label>
      )}
    </ActionForm>
  );
}

function Renumber({
  current,
  onSubmit,
}: {
  current: number;
  onSubmit: (reason: string, teamNumber: number) => Promise<void>;
}) {
  const [number, setNumber] = useState("");
  return (
    <ActionForm
      title="Change the team number"
      description={`Moves the team from ${current} to its real number. Its accounts, Slack and kiosks stay; its addresses change, and ${current} is free again.`}
      button="Change number"
      onSubmit={(reason) => onSubmit(reason, Number(number))}
    >
      <input
        required
        inputMode="numeric"
        pattern="[0-9]*"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder="New team number"
        className={fieldClass}
      />
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
      description="Deletes the team for good: every account on it, their sign-ins, its kiosks and its Slack connection. The number is free again. This can't be undone."
      button="Delete for good"
      danger
      onSubmit={(reason) => onSubmit(reason, Number(confirm))}
    >
      <input
        required
        inputMode="numeric"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={`Type ${number} to confirm`}
        className={fieldClass}
      />
    </ActionForm>
  );
}
