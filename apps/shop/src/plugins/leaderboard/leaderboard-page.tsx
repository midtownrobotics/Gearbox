import { useEffect, useMemo, useState } from "react";
import { fetchActions } from "../../shared/getters";
import type { Action } from "../../shared/types";
import { ErrorBanner, PageLoading } from "../../shared/ui";
import { useUserNames } from "../../shared/use-user-names";

const MEDALS: Record<number, { emoji: string; ring: string }> = {
  0: { emoji: "🥇", ring: "bg-amber-50 border-amber-400" },
  1: { emoji: "🥈", ring: "bg-slate-50 border-slate-400" },
  2: { emoji: "🥉", ring: "bg-orange-50 border-orange-400" },
};

export function LeaderboardPage() {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchActions()
      .then(setActions)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load leaderboard."));
  }, []);

  const standings = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of actions ?? []) {
      if (a.action !== "completed") continue;
      counts.set(a.userId, (counts.get(a.userId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([userId, completed]) => ({ userId, completed }))
      .sort((a, b) => b.completed - a.completed);
  }, [actions]);

  const resolveName = useUserNames(standings.map((s) => s.userId));

  if (error)
    return (
      <main className="min-h-screen bg-page">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <ErrorBanner message={error} />
        </div>
      </main>
    );
  if (!actions) return <PageLoading />;

  return (
    <main className="min-h-screen bg-page">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-5">
        <div>
          <h1 className="font-display text-4xl text-ink">Leaderboard</h1>
          <p className="text-steel-dark mt-1 text-sm">Ranked by parts marked complete.</p>
        </div>

        {standings.length === 0 ? (
          <p className="text-steel text-sm">
            No parts completed yet — finish a part on the shop floor to get on the board.
          </p>
        ) : (
          <div className="space-y-2">
            {standings.map((s, i) => {
              const medal = MEDALS[i];
              return (
                <div
                  key={s.userId}
                  className={`flex items-center gap-4 rounded-xl border px-5 ${
                    medal ? `${medal.ring} py-4` : "bg-paper border-steel/25 py-3"
                  }`}
                >
                  <span
                    className={`font-display shrink-0 text-center ${medal ? "text-3xl w-10" : "text-xl w-10 text-steel"}`}
                  >
                    {medal ? medal.emoji : `#${i + 1}`}
                  </span>
                  <span
                    className={`flex-1 min-w-0 truncate font-semibold ${medal ? "text-lg text-ink" : "text-ink"}`}
                  >
                    {resolveName(s.userId)}
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`font-bold ${medal ? "text-2xl text-ink" : "text-lg text-steel-dark"}`}
                    >
                      {s.completed}
                    </span>
                    <span className="text-xs text-steel ml-1.5">
                      part{s.completed === 1 ? "" : "s"}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
