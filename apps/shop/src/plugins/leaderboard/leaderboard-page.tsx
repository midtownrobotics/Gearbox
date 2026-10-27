import { ErrorBanner, Loading, Page } from "@g3/ui";
import { useEffect, useMemo, useState } from "react";
import { fetchActions } from "../../shared/getters";
import { ProjectFilter, useDataInProject, useProjectFilter } from "../../shared/projects";
import type { Action } from "../../shared/types";
import { useShopData } from "../../shared/use-shop-data";
import { useUserNames } from "../../shared/use-user-names";

const MEDALS: Record<number, { emoji: string; ring: string }> = {
  0: { emoji: "🥇", ring: "bg-amber-50 border-amber-400" },
  1: { emoji: "🥈", ring: "bg-slate-50 border-slate-400" },
  2: { emoji: "🥉", ring: "bg-orange-50 border-orange-400" },
};

export function LeaderboardPage() {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // With a project chosen, only the parts made for it count.
  const projectFilter = useProjectFilter();
  const { data } = useShopData();
  const projectData = useDataInProject(data, projectFilter.projectId);

  useEffect(() => {
    fetchActions()
      .then(setActions)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load leaderboard."));
  }, []);

  const standings = useMemo(() => {
    const inProject =
      projectFilter.projectId === null || !projectData
        ? null
        : new Set(projectData.instances.map((i) => i.id));
    const counts = new Map<string, number>();
    for (const a of actions ?? []) {
      if (a.action !== "completed") continue;
      if (inProject && !inProject.has(a.partInstanceId)) continue;
      counts.set(a.userId, (counts.get(a.userId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([userId, completed]) => ({ userId, completed }))
      .sort((a, b) => b.completed - a.completed);
  }, [actions, projectData, projectFilter.projectId]);

  const resolveName = useUserNames(standings.map((s) => s.userId));

  if (error || !actions)
    return (
      <Page title="Leaderboard" width="narrow">
        {error ? <ErrorBanner message={error} /> : <Loading />}
      </Page>
    );

  return (
    <Page
      title="Leaderboard"
      description="Ranked by parts marked complete."
      width="narrow"
      actions={<ProjectFilter filter={projectFilter} />}
    >
      {standings.length === 0 ? (
        <p className="text-secondary-500 text-sm">
          No parts completed yet. Finish a part on the shop floor to get on the board.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {standings.map((s, i) => {
              const medal = MEDALS[i];
              return (
                <div
                  key={s.userId}
                  className={`flex items-center gap-4 rounded-xl border px-5 ${
                    medal ? `${medal.ring} py-4` : "bg-surface border-secondary-200 py-3"
                  }`}
                >
                  <span
                    className={`font-display shrink-0 text-center ${medal ? "text-3xl w-10" : "text-xl w-10 text-secondary-400"}`}
                  >
                    {medal ? medal.emoji : `#${i + 1}`}
                  </span>
                  <span
                    className={`flex-1 min-w-0 truncate font-semibold ${medal ? "text-lg text-secondary-900" : "text-secondary-900"}`}
                  >
                    {resolveName(s.userId)}
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`font-bold ${medal ? "text-2xl text-secondary-900" : "text-lg text-secondary-500"}`}
                    >
                      {s.completed}
                    </span>
                    <span className="text-xs text-secondary-400 ml-1.5">
                      part{s.completed === 1 ? "" : "s"}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Page>
  );
}
