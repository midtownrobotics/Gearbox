import { useState } from "react";
import { Link } from "react-router-dom";
import { type TeamRow, consoleApi, formatDate, read, useLoad } from "./data";
import { Notice, Panel, StatusBadge, fieldClass } from "./shell";

// Every team on the platform, with the reports open against its number.

export function TeamsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const teams = useLoad(
    () => read<TeamRow[]>(consoleApi.teams.$get({ query: { q, status } })),
    [q, status],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Team number or name"
          className={`${fieldClass} max-w-xs`}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={`${fieldClass} w-40`}
        >
          <option value="">Every status</option>
          <option value="active">Active</option>
          <option value="pending">Signing up</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      {teams.error && <Notice>{teams.error}</Notice>}
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-secondary-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Number</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Slack</th>
                <th className="py-2 pr-4 font-medium">Country</th>
                <th className="py-2 pr-4 font-medium">Signed up</th>
                <th className="py-2 font-medium">Open reports</th>
              </tr>
            </thead>
            <tbody>
              {teams.data?.map((team) => (
                <tr key={team.id} className="border-t border-line">
                  <td className="py-2 pr-4 font-semibold">
                    <Link
                      to={`/console/teams/${team.id}`}
                      className="text-primary-600 hover:underline"
                    >
                      {team.teamNumber}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-secondary-900">
                    {team.name}
                    {team.isSite && <span className="ml-2 text-xs text-secondary-500">(site)</span>}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={team.status} />
                  </td>
                  <td className="py-2 pr-4 text-secondary-600">{team.slackWorkspaceName ?? "—"}</td>
                  <td className="py-2 pr-4 text-secondary-600">{team.country}</td>
                  <td className="py-2 pr-4 text-secondary-600">{formatDate(team.createdAt)}</td>
                  <td className="py-2">
                    {team.openReports > 0 ? (
                      <span className="font-semibold text-red-700">{team.openReports}</span>
                    ) : (
                      <span className="text-secondary-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {teams.data?.length === 0 && (
            <p className="py-6 text-center text-sm text-secondary-500">No teams match.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}
