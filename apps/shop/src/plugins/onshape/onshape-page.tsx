import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchOnshapeReleases } from "../../shared/getters";
import type { OnshapeRelease } from "../../shared/types";
import { ErrorBanner, PageLoading } from "../../shared/ui";
import { day, td, th, when } from "./release-ui";

// The team's Onshape releases as a table, newest first: what each was called, when, who made and
// approved it. A row opens the release's own page (release-page.tsx) with its parts.

const has = (text: string | null | undefined, q: string) => !!text?.toLowerCase().includes(q);

function matches(release: OnshapeRelease, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    release.name,
    release.notes,
    release.madeBy,
    ...release.approvers.map((a) => a.name),
    ...release.parts.flatMap((p) => [p.partNumber, p.name]),
  ].some((f) => has(f, q));
}

export function OnshapePage() {
  const navigate = useNavigate();
  const [releases, setReleases] = useState<OnshapeRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetchOnshapeReleases()
      .then(setReleases)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load releases."));
  }, []);

  const shown = useMemo(() => (releases ?? []).filter((r) => matches(r, query)), [releases, query]);

  if (error)
    return (
      <main className="min-h-screen bg-page">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <ErrorBanner message={error} />
        </div>
      </main>
    );
  if (!releases) return <PageLoading />;

  return (
    <main className="min-h-screen bg-page">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        <div>
          <h1 className="font-display text-4xl text-ink">Onshape</h1>
          <p className="text-steel-dark mt-1 text-sm">
            Every approved release. Open one to see its parts and comments.
          </p>
        </div>

        {releases.length === 0 ? (
          <p className="text-steel text-sm">
            No releases yet. Approved releases in your team's Onshape document show up here.
          </p>
        ) : (
          <>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search releases, people or part numbers"
              className="w-full bg-paper border border-steel/40 rounded-lg px-3 py-2 text-sm text-ink placeholder-steel focus:outline-none focus:border-crimson"
            />

            {shown.length === 0 ? (
              <p className="text-steel text-sm">No releases match "{query}".</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-steel/25 bg-paper">
                <table className="w-full text-sm">
                  <thead className="bg-mist">
                    <tr>
                      <th className={th}>Release</th>
                      <th className={th}>Released</th>
                      <th className={th}>Made by</th>
                      <th className={th}>Approved by</th>
                      <th className={`${th} text-right`}>Parts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((release) => {
                      const to = `/onshape/releases/${release.id}`;
                      const approved = release.approvers.filter((a) => a.approvedAt);
                      return (
                        <tr
                          key={release.id}
                          onClick={() => navigate(to)}
                          className="cursor-pointer border-t border-steel/15 hover:bg-mist"
                        >
                          <td className={td}>
                            <Link
                              to={to}
                              onClick={(e) => e.stopPropagation()}
                              className="font-semibold text-ink break-words hover:text-crimson"
                            >
                              {release.name ?? (
                                <span className="font-mono font-normal text-steel-dark">
                                  {release.releaseId}
                                </span>
                              )}
                            </Link>
                          </td>
                          <td
                            className={`${td} text-ink whitespace-nowrap`}
                            title={when(release.releasedAt) ?? undefined}
                          >
                            {day(release.releasedAt) ?? release.releasedAt}
                          </td>
                          <td className={`${td} text-ink`}>{release.madeBy ?? "–"}</td>
                          <td className={`${td} text-ink`}>
                            {approved.length > 0 ? approved.map((a) => a.name).join(", ") : "–"}
                          </td>
                          <td className={`${td} text-ink text-right tabular-nums`}>
                            {release.parts.length}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
