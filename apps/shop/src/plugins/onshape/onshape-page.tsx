import { ErrorBanner, Loading, Page, Switch, TextField } from "@g3/ui";
import { useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchOnshapeReleases } from "../../shared/getters";
import type { OnshapeRelease } from "../../shared/types";
import {
  PART_SORTS,
  SORTS,
  type Sort,
  type SortKey,
  shownGroup,
  sortGroups,
  sortLines,
  startingDir,
} from "./release-rows";
import { ReleasesTable } from "./releases-table";

// The team's Onshape releases and their parts as one table (releases-table.tsx). Sorted by one of
// a release's columns (its name, when it was released, who made it, who approved it) it lists each
// release once with its parts; sorted by one of a part's columns it lists every part on a line of
// its own. A release's name opens its own page (release-page.tsx). The sort, the search and whether
// obsolete parts are shown live in the address, so coming back from a release finds the table as
// it was.

export function OnshapePage() {
  const [releases, setReleases] = useState<OnshapeRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const obsoleteLabel = useId();

  useEffect(() => {
    fetchOnshapeReleases()
      .then(setReleases)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load releases."));
  }, []);

  const query = params.get("q") ?? "";
  const showObsolete = params.get("obsolete") !== "hide";
  const key = SORTS.find((s) => s === params.get("sort")) ?? "released";
  const dirParam = params.get("dir");
  const sort: Sort = {
    key,
    dir: dirParam === "asc" || dirParam === "desc" ? dirParam : startingDir(key),
  };
  const { dir } = sort;

  /** Changes the address in place; a null value takes the name out of it. */
  const setParam = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [name, value] of Object.entries(changes)) {
          if (value === null) next.delete(name);
          else next.set(name, value);
        }
        return next;
      },
      { replace: true },
    );

  const sortBy = (next: SortKey) => {
    const nextDir = next !== key ? startingDir(next) : dir === "asc" ? "desc" : "asc";
    setParam({
      sort: next === "released" ? null : next,
      dir: nextDir === startingDir(next) ? null : nextDir,
    });
  };

  const groups = useMemo(
    () => (releases ?? []).flatMap((r) => shownGroup(r, query, showObsolete) ?? []),
    [releases, query, showObsolete],
  );
  const flat = PART_SORTS.includes(key);
  const grouped = useMemo(
    () => (flat ? [] : sortGroups(groups, { key, dir })),
    [groups, flat, key, dir],
  );
  const lines = useMemo(
    () => (flat ? sortLines(groups, { key, dir }) : []),
    [groups, flat, key, dir],
  );

  if (error || !releases)
    return (
      <Page title="Onshape" width="wide">
        {error ? <ErrorBanner message={error} /> : <Loading />}
      </Page>
    );

  const partCount = groups.reduce((n, g) => n + g.parts.length, 0);
  const hidden = showObsolete
    ? 0
    : releases.reduce((n, r) => n + r.parts.filter((p) => p.obsolete).length, 0);
  const empty = flat ? lines.length === 0 : groups.length === 0;

  return (
    <Page
      title="Onshape"
      description="Every approved release and its parts. Open a release for its notes, comments and links."
      width="wide"
    >
      {releases.length === 0 ? (
        <p className="text-secondary-500 text-sm">
          No releases yet. Approved releases in your team's Onshape document show up here.
        </p>
      ) : (
        <>
          <div className="space-y-3">
            <TextField
              type="search"
              value={query}
              onChange={(e) => setParam({ q: e.target.value || null })}
              placeholder="Search releases, people or parts"
            />
            <div className="flex items-center gap-2 text-sm text-secondary-900">
              <Switch
                checked={showObsolete}
                onChange={(on) => setParam({ obsolete: on ? null : "hide" })}
                aria-labelledby={obsoleteLabel}
              />
              <span id={obsoleteLabel}>Show obsolete parts</span>
            </div>
          </div>

          {empty ? (
            <p className="text-secondary-500 text-sm">
              {query.trim() ? `Nothing matches "${query.trim()}".` : "No parts to show."}
            </p>
          ) : (
            <>
              <ReleasesTable
                grouped={grouped}
                lines={lines}
                flat={flat}
                sort={sort}
                onSort={sortBy}
              />
              <p className="text-xs text-secondary-400">
                {partCount} {partCount === 1 ? "part" : "parts"} in {groups.length}{" "}
                {groups.length === 1 ? "release" : "releases"}
                {hidden > 0 && ` · ${hidden} obsolete not shown`}
              </p>
            </>
          )}
        </>
      )}
    </Page>
  );
}
