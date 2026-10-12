import { ErrorBanner, Loading, Page, inputClass } from "@g3/ui";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchOnshapeReleases } from "../../shared/getters";
import type { OnshapeRelease } from "../../shared/types";
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

  if (error || !releases)
    return (
      <Page title="Onshape" width="wide">
        {error ? <ErrorBanner message={error} /> : <Loading />}
      </Page>
    );

  return (
    <Page
      title="Onshape"
      description="Every approved release. Open one to see its parts and comments."
      width="wide"
    >
      {releases.length === 0 ? (
        <p className="text-secondary-500 text-sm">
          No releases yet. Approved releases in your team's Onshape document show up here.
        </p>
      ) : (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search releases, people or part numbers"
            className={inputClass}
          />

          {shown.length === 0 ? (
            <p className="text-secondary-500 text-sm">No releases match "{query}".</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-secondary-200 bg-surface">
              <table className="w-full text-sm">
                <thead className="bg-page">
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
                        className="cursor-pointer border-t border-secondary-200 hover:bg-secondary-50"
                      >
                        <td className={td}>
                          <Link
                            to={to}
                            onClick={(e) => e.stopPropagation()}
                            className="font-semibold text-secondary-900 break-words hover:text-primary-600"
                          >
                            {release.name ?? (
                              <span className="font-mono font-normal text-secondary-500">
                                {release.releaseId}
                              </span>
                            )}
                          </Link>
                        </td>
                        <td
                          className={`${td} text-secondary-900 whitespace-nowrap`}
                          title={when(release.releasedAt) ?? undefined}
                        >
                          {day(release.releasedAt) ?? release.releasedAt}
                        </td>
                        <td className={`${td} text-secondary-900`}>{release.madeBy ?? "–"}</td>
                        <td className={`${td} text-secondary-900`}>
                          {approved.length > 0 ? approved.map((a) => a.name).join(", ") : "–"}
                        </td>
                        <td className={`${td} text-secondary-900 text-right tabular-nums`}>
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
    </Page>
  );
}
