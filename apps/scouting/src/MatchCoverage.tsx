import { Button, inputClass } from "@g3/ui";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

type Coverage = {
  eventKey: string;
  currentMatchKey: string | null;
  forms: { id: string; name: string }[];
  matches: {
    key: string;
    label: string;
    played: boolean;
    teams: {
      team: string;
      alliance: "red" | "blue";
      assignedScouts: number;
      forms: { id: string; name: string; reports: number }[];
    }[];
  }[];
};

export function MatchCoverage() {
  const [data, setData] = useState<Coverage | null>(null);
  const [matchKey, setMatchKey] = useState("current");
  const [missingOnly, setMissingOnly] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Coverage>("/match-coverage", { cache: "no-store" }));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check missing reports.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    const refresh = () => void load();
    window.addEventListener("scouting-schedule-mode-changed", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scouting-schedule-mode-changed", refresh);
    };
  }, [load]);
  const selected =
    data?.matches.filter(
      (match) =>
        matchKey === "all" ||
        match.key === (matchKey === "current" ? data.currentMatchKey : matchKey),
    ) ?? [];
  return (
    <section
      className="space-y-3 rounded-xl border border-line bg-surface p-4"
      aria-label="Missing match reports"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Missing match reports</h2>
        <Button type="button" variant="secondary" disabled={loading} onClick={() => void load()}>
          {loading ? "Checking…" : "Refresh"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
          {data ? " Showing the last successful check." : ""}
        </p>
      )}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="grid gap-1 text-sm">
              Match
              <select
                className={inputClass}
                value={matchKey}
                onChange={(event) => setMatchKey(event.target.value)}
              >
                <option value="current">Current match</option>
                <option value="all">All event matches</option>
                {data.matches.map((match) => (
                  <option key={match.key} value={match.key}>
                    {match.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={missingOnly}
                onChange={(event) => setMissingOnly(event.target.checked)}
              />
              Only teams missing forms
            </label>
          </div>
          {!data.forms.length && (
            <p className="text-sm text-secondary-500">
              No active match forms with questions. Activate a form to track coverage.
            </p>
          )}
          {data.forms.length > 0 &&
            selected.map((match) => {
              const missing = match.teams.reduce(
                (total, team) => total + team.forms.filter((form) => form.reports === 0).length,
                0,
              );
              const teams = match.teams.filter(
                (team) => !missingOnly || team.forms.some((form) => form.reports === 0),
              );
              return (
                <details
                  key={`${data.eventKey}:${match.key}`}
                  open={matchKey !== "all"}
                  className="rounded-lg border border-line"
                >
                  <summary className="cursor-pointer px-3 py-3 text-sm font-semibold">
                    {match.label}
                    <span className="ml-2 font-normal text-secondary-500">
                      {missing} of {match.teams.length * data.forms.length} reports missing
                      {match.key === data.currentMatchKey
                        ? " · Current"
                        : !match.played
                          ? " · Upcoming / unscored"
                          : ""}
                    </span>
                  </summary>
                  <div className="space-y-2 border-t border-line p-3">
                    {teams.map((team) => (
                      <div
                        key={team.team}
                        className={`rounded-lg border-l-4 bg-inset px-3 py-2 ${team.alliance === "red" ? "border-red-400" : "border-blue-400"}`}
                      >
                        <div className="flex flex-wrap justify-between gap-2 text-sm">
                          <strong>Team {team.team}</strong>
                          <span className="text-xs text-secondary-500">
                            {team.assignedScouts} assigned
                          </span>
                        </div>
                        <ul className="mt-1 space-y-1 text-sm">
                          {team.forms.map((form) => (
                            <li key={form.id} className="flex flex-wrap justify-between gap-x-3">
                              <span>{form.name}</span>
                              <span
                                className={
                                  form.reports ? "text-green-700" : "font-semibold text-amber-700"
                                }
                              >
                                {form.reports ? `${form.reports} submitted` : "Not submitted"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {!teams.length && (
                      <p className="text-sm text-green-700">
                        All active forms have a report for every robot.
                      </p>
                    )}
                  </div>
                </details>
              );
            })}
          {data.forms.length > 0 && !selected.length && (
            <p className="text-sm text-secondary-500">
              No match selected or available. Choose a match from the event schedule.
            </p>
          )}
        </>
      )}
    </section>
  );
}
