import { Chip, ErrorBanner, Loading, Page } from "@g3/ui";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchLeaderboard } from "../../shared/getters";
import type { Standing } from "../../shared/types";
import { useUserNames } from "../../shared/use-user-names";

const MEDALS: Record<number, { emoji: string; ring: string }> = {
  0: { emoji: "🥇", ring: "bg-amber-50 border-amber-400" },
  1: { emoji: "🥈", ring: "bg-slate-50 border-slate-400" },
  2: { emoji: "🥉", ring: "bg-orange-50 border-orange-400" },
};

type Ranking = "points" | "steps";

const RANKINGS: Record<
  Ranking,
  { label: string; description: string; unit: (n: number) => string }
> = {
  points: {
    label: "By time",
    description:
      "Each step is worth about the minutes it usually takes the team, so longer work counts for more.",
    unit: (n) => (n === 1 ? "point" : "points"),
  },
  steps: {
    label: "By steps",
    description: "Ranked by steps completed on the shop floor.",
    unit: (n) => (n === 1 ? "step" : "steps"),
  },
};

export function LeaderboardPage() {
  const [standings, setStandings] = useState<Standing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const ranking: Ranking = params.get("by") === "steps" ? "steps" : "points";

  useEffect(() => {
    fetchLeaderboard()
      .then(setStandings)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load leaderboard."));
  }, []);

  const ranked = useMemo(
    () =>
      (standings ?? [])
        .filter((s) => s[ranking] > 0)
        .sort((a, b) => b[ranking] - a[ranking] || b.steps - a.steps),
    [standings, ranking],
  );

  const resolveName = useUserNames(ranked.map((s) => s.userId));
  const { description, unit } = RANKINGS[ranking];

  if (error || !standings)
    return (
      <Page title="Leaderboard" width="narrow">
        {error ? <ErrorBanner message={error} /> : <Loading />}
      </Page>
    );

  return (
    <Page title="Leaderboard" description={description} width="narrow">
      <div className="flex gap-2 mb-4">
        {(Object.keys(RANKINGS) as Ranking[]).map((key) => (
          <Chip
            key={key}
            selected={ranking === key}
            onClick={() => setParams(key === "points" ? {} : { by: key }, { replace: true })}
          >
            {RANKINGS[key].label}
          </Chip>
        ))}
      </div>
      {ranked.length === 0 ? (
        <p className="text-secondary-500 text-sm">
          Nothing completed yet. Finish a step on the shop floor to get on the board.
        </p>
      ) : (
        <div className="space-y-2">
          {ranked.map((s, i) => {
            const medal = MEDALS[i];
            const value = s[ranking];
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
                    {value.toLocaleString()}
                  </span>
                  <span className="text-xs text-secondary-400 ml-1.5">{unit(value)}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}
