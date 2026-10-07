import { Link } from "react-router-dom";
import { type Action, consoleApi, formatTime, read, useLoad } from "./data";
import { Notice, Panel } from "./shell";

// Everything operators have done, and each time one looked at a team's members, newest first.
// Kept 12 months (the privacy policy's operator access log).

export function LogPage() {
  const actions = useLoad(() => read<Action[]>(consoleApi.actions.$get({ query: {} })), []);
  return (
    <div className="space-y-4">
      {actions.error && <Notice>{actions.error}</Notice>}
      <Panel>{actions.data && <ActionList actions={actions.data} showTeam />}</Panel>
    </div>
  );
}

const str = (value: unknown) => String(value ?? "");

/** What an action did, in a sentence. */
function describe(action: Action): string {
  const d = action.details;
  switch (action.action) {
    case "view_team":
      return "Looked at the team's members";
    case "delete_team":
      return `Deleted team ${str(d.teamNumber)} (${str(d.name)}) and ${str(d.deletedAccounts)} accounts`;
    // Renumbering was removed; kept so a past log row still reads.
    case "renumber_team":
      return `Changed team ${str(d.from)} to ${str(d.to)}`;
    case "transfer_owner":
      return `Handed the team over${d.previousKeptAdmin === false ? ", removing the previous owner's admin" : ""}`;
    case "suspend_team":
      return "Suspended the team";
    case "reactivate_team":
      return "Reactivated the team";
    case "resolve_report":
      return `Resolved a report about team ${str(d.teamNumber)}`;
    case "reopen_report":
      return `Reopened a report about team ${str(d.teamNumber)}`;
    case "add_operator":
      return `Added ${str(d.displayName || d.userId)} as an operator`;
    case "remove_operator":
      return `Removed operator ${str(d.userId)}`;
    default:
      return action.action;
  }
}

export function ActionList({ actions, showTeam }: { actions: Action[]; showTeam: boolean }) {
  if (actions.length === 0) return <p className="text-sm text-secondary-500">Nothing yet.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {actions.map((a) => (
        <li key={a.id} className="space-y-0.5 py-2">
          <div className="flex flex-wrap gap-x-3">
            <span className="text-secondary-900">{describe(a)}</span>
            {showTeam && a.teamId && a.action !== "delete_team" && (
              <Link to={`/console/teams/${a.teamId}`} className="text-primary-600 hover:underline">
                {a.teamId.replace(/^frc/, "Team ")}
              </Link>
            )}
          </div>
          <div className="text-secondary-500">
            {a.operatorName} · {formatTime(a.createdAt)}
            {a.reason && <> · “{a.reason}”</>}
          </div>
        </li>
      ))}
    </ul>
  );
}
