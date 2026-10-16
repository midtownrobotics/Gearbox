import { Card, ErrorBanner, Page, TextField, inputClass } from "@g3/ui";
import { useState } from "react";
import { Link } from "react-router-dom";
import { type TeamRow, consoleApi, formatDate, read, useLoad } from "./data";
import { StatusBadge } from "./shell";

// Every team on the platform, with the reports open against its number.

export function TeamsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const teams = useLoad(
    () => read<TeamRow[]>(consoleApi.teams.$get({ query: { q, status } })),
    [q, status],
  );

  return (
    <Page title="Teams" width="wide">
      <div className="flex flex-wrap gap-2">
        <TextField
          kind="label"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Team number or name"
          aria-label="Search teams"
          className="max-w-xs"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={`${inputClass} max-w-40`}
          aria-label="Status"
        >
          <option value="">Every status</option>
          <option value="active">Active</option>
          <option value="pending">Signing up</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      {teams.error && <ErrorBanner message={teams.error} />}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-xs font-bold uppercase tracking-wider text-secondary-400">
                <th className="py-2 pr-4">Number</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Slack</th>
                <th className="py-2 pr-4">Country</th>
                <th className="py-2 pr-4">Signed up</th>
                <th className="py-2">Open reports</th>
              </tr>
            </thead>
            <tbody>
              {teams.data?.map((team) => (
                <tr key={team.id} className="border-t border-line first:border-0">
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
      </Card>
    </Page>
  );
}
