import { Button } from "@g3/ui";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

type Coverage = {
  eventKey: string;
  total: number;
  completed: number;
  remaining: { number: string; name: string }[];
};

export function PitCoverage({
  refreshKey,
  onStart,
}: { refreshKey?: number; onStart?: (team: string) => void }) {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCoverage(await api<Coverage>("/pit-coverage"));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load pit scouting coverage.");
      setCoverage(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refreshKey;
    void load();
  }, [load, refreshKey]);
  return (
    <details className="rounded-xl border border-line bg-surface">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
        Not pit scouted{coverage ? ` · ${coverage.remaining.length} teams remaining` : ""}
      </summary>
      <div className="space-y-3 border-t border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-secondary-500">
            {coverage
              ? `${coverage.completed} of ${coverage.total} teams completed · ${coverage.eventKey}`
              : "Event coverage"}
          </p>
          <Button variant="secondary" type="button" disabled={loading} onClick={() => void load()}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {coverage && (
          <>
            <p className="text-xs text-secondary-500">
              A team is completed once any pit form has been submitted for this event.
            </p>
            <ul className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {coverage.remaining.map((team) => (
                <li key={team.number} className="flex gap-2 rounded-lg bg-inset px-3 py-2 text-sm">
                  <strong>{team.number}</strong>
                  <span className="min-w-0 flex-1 break-words text-secondary-500">{team.name}</span>
                  {onStart && (
                    <button
                      type="button"
                      className="shrink-0 font-semibold text-primary-700 hover:underline"
                      aria-label={`Start pit scouting team ${team.number}`}
                      onClick={() => onStart(team.number)}
                    >
                      Scout
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!coverage.remaining.length && (
              <p className="text-sm">Every event team has been pit scouted.</p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
