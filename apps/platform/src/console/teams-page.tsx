// SPDX-License-Identifier: AGPL-3.0-only
import { teamNumberLabel } from "@g3/site-config";
import { Button, Card, ErrorBanner, Page, TextField, inputClass } from "@g3/ui";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  type Storage,
  type TeamRow,
  chatName,
  consoleApi,
  formatBytes,
  formatDate,
  read,
  useLoad,
} from "./data";
import { StatusBadge } from "./shell";

// Every team on the platform, with how many members it has and the reports open against its
// number. How much each keeps in storage is counted on a button: every app lists all its files.

export function TeamsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const teams = useLoad(
    () => read<TeamRow[]>(consoleApi.teams.$get({ query: { q, status } })),
    [q, status],
  );
  const [storage, setStorage] = useState<Storage | null>(null);
  const [counting, setCounting] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  async function countStorage() {
    setCounting(true);
    setStorageError(null);
    try {
      setStorage(await read<Storage>(consoleApi.storage.$get()));
    } catch (err) {
      setStorageError((err as Error).message);
    } finally {
      setCounting(false);
    }
  }

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
        <Button variant="secondary" onClick={countStorage} disabled={counting}>
          {counting ? "Counting…" : storage ? "Count storage again" : "Count storage"}
        </Button>
      </div>
      {teams.error && <ErrorBanner message={teams.error} />}
      {storageError && <ErrorBanner message={storageError} />}
      {storage && storage.failed.length > 0 && (
        <ErrorBanner
          message={`Storage leaves out ${storage.failed.join(", ")}, which didn't answer.`}
        />
      )}
      <Card>
        <div className="relative overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-xs font-bold uppercase tracking-wider text-secondary-400">
                <th className="py-2 pr-4">Number</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Chat</th>
                <th className="py-2 pr-4">Members</th>
                <th className="py-2 pr-4">Storage</th>
                <th className="py-2 pr-4">Country</th>
                <th className="py-2 pr-4">Signed up</th>
                <th className="py-2">Open number reports</th>
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
                      {teamNumberLabel(team.id)}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-secondary-900">
                    {team.name}
                    {team.isSite && <span className="ml-2 text-xs text-secondary-500">(site)</span>}
                  </td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={team.status} />
                  </td>
                  <td className="py-2 pr-4 text-secondary-600">{chatName(team.chat)}</td>
                  <td className="py-2 pr-4 text-secondary-600">{team.members ?? "—"}</td>
                  <td className="py-2 pr-4 whitespace-nowrap text-secondary-600">
                    <StorageCell storage={storage} teamId={team.id} />
                  </td>
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

/** A team's storage once counted: its total, with each app's share on hover. */
function StorageCell({ storage, teamId }: { storage: Storage | null; teamId: string }) {
  if (!storage) return <span className="text-secondary-400">—</span>;
  const used = storage.teams[teamId];
  if (!used) return <span className="text-secondary-400">0 B</span>;
  const byApp = Object.entries(used.apps)
    .map(([app, bytes]) => `${app}: ${formatBytes(bytes)}`)
    .join(", ");
  return (
    <span title={`${byApp} (${used.objects.toLocaleString()} files)`}>
      {formatBytes(used.bytes)}
    </span>
  );
}
