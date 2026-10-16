import {
  Badge,
  Button,
  Card,
  Chip,
  ErrorBanner,
  Field,
  Loading,
  Page as SharedPage,
  Stat,
  inputClass,
  tones,
} from "@g3/ui";
import { Coins, Loader2, RefreshCw, Trophy, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EngagementSettings } from "./EngagementSettings";
import { api } from "./api";

type Market = "spread";
type Selection = "red" | "blue";
type MatchPredictionsMatch = {
  key: string;
  label: string;
  matchNumber: number;
  startTime: number | null;
  redTeams: string[];
  blueTeams: string[];
  prediction: { redScore: number; blueScore: number; redWinProbability: number };
  markets: {
    spread: { red: number; blue: number; redOdds: number; blueOdds: number };
  };
};
type MatchPredictionsData = {
  settings: EngagementSettings;
  eventKey: string;
  account: { balance: number; earned: number; wagered: number };
  leaderboard: { display_name: string; balance: number; earned: number; wagered: number }[];
  bets: {
    id: string;
    match_key: string;
    match_label: string;
    market: Market;
    selection: Selection;
    line: number;
    odds: number;
    stake: number;
    status: "open" | "won" | "lost" | "push";
    payout: number;
  }[];
  parlays: {
    id: string;
    odds: number;
    stake: number;
    status: "open" | "won" | "lost" | "push";
    payout: number;
    legs: {
      match_label: string;
      market: Market;
      selection: Selection;
      line: number;
      odds: number;
      status: "open" | "won" | "lost" | "push";
    }[];
  }[];
  matches: MatchPredictionsMatch[];
  statsError: string;
};
type PickSlip = {
  match: MatchPredictionsMatch;
  market: Market;
  selection: Selection;
  line: number;
  label: string;
  odds: number;
};

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function americanToDecimal(odds: number) {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function combinedOdds(legs: PickSlip[]) {
  const decimal = legs.reduce((total, leg) => total * americanToDecimal(leg.odds), 1);
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : -Math.round(100 / Math.max(0.01, decimal - 1));
}

function statusLabel(status: "open" | "won" | "lost" | "push") {
  return { open: "Pending", won: "Correct", lost: "Incorrect", push: "Points returned" }[status];
}

export function MatchPredictions({ predictionsEnabled = true }: { predictionsEnabled?: boolean }) {
  const [data, setData] = useState<MatchPredictionsData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const pendingLoad = useRef<Promise<void> | null>(null);
  const [placing, setPlacing] = useState(false);
  const [section, setSection] = useState<"predictions" | "leaderboard">("predictions");
  const [slip, setSlip] = useState<PickSlip[]>([]);
  const [stake, setStake] = useState(10);

  const load = useCallback(() => {
    if (pendingLoad.current) return pendingLoad.current;
    const request = (async () => {
      setRefreshing(true);
      setMatchesLoading(true);
      setError("");
      try {
        const summary = await api<MatchPredictionsData>("/game?summary=true", {
          signal: AbortSignal.timeout(6000),
        });
        setData((current) => ({
          ...summary,
          matches: current?.eventKey === summary.eventKey ? current.matches : [],
        }));
        setLoading(false);
        if (!summary.settings.predictionsEnabled) setSection("leaderboard");
        else if (!summary.settings.leaderboardEnabled) setSection("predictions");
        if (!summary.settings.combinationsEnabled) setSlip((current) => current.slice(0, 1));
        if (!summary.settings.predictionsEnabled || !summary.eventKey) {
          setSlip([]);
          return;
        }
        const next = await api<MatchPredictionsData>("/game", {
          signal: AbortSignal.timeout(6000),
        });
        setData(next);
        setSlip((current) =>
          current.filter((leg) =>
            next.matches.some(
              (match) =>
                match.key === leg.match.key && match.markets.spread[leg.selection] === leg.line,
            ),
          ),
        );
      } catch (cause) {
        // Points and history remain useful when the prediction service cannot be reached.
        setData((current) => (current ? { ...current, matches: [] } : null));
        setSlip([]);
        setError(
          cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")
            ? "The request took too long. Try refreshing."
            : cause instanceof Error
              ? cause.message
              : "Could not load match predictions.",
        );
      } finally {
        setLoading(false);
        setMatchesLoading(false);
        setRefreshing(false);
        pendingLoad.current = null;
      }
    })();
    pendingLoad.current = request;
    return request;
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  async function placeBet() {
    if (!slip.length || !Number.isInteger(stake) || stake < 1) return;
    setPlacing(true);
    setError("");
    try {
      await api(slip.length > 1 ? "/game/parlays" : "/game/bets", {
        method: "POST",
        body: JSON.stringify(
          slip.length > 1
            ? {
                legs: slip.map((leg) => ({
                  matchKey: leg.match.key,
                  market: leg.market,
                  selection: leg.selection,
                  expectedLine: leg.line,
                })),
                stake,
              }
            : {
                matchKey: slip[0].match.key,
                market: slip[0].market,
                selection: slip[0].selection,
                expectedLine: slip[0].line,
                stake,
              },
        ),
      });
      setSlip([]);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit the pick.");
    } finally {
      setPlacing(false);
    }
  }

  function choose(next: PickSlip) {
    setSlip((current) => {
      const withoutMatch = current.filter((leg) => leg.match.key !== next.match.key);
      const alreadySelected = current.some(
        (leg) =>
          leg.match.key === next.match.key &&
          leg.market === next.market &&
          leg.selection === next.selection,
      );
      return alreadySelected
        ? withoutMatch
        : data?.settings.combinationsEnabled
          ? [...withoutMatch, next].slice(0, 8)
          : [next];
    });
  }

  function isSelected(matchKey: string, market: Market, selection: Selection) {
    return slip.some(
      (leg) => leg.match.key === matchKey && leg.market === market && leg.selection === selection,
    );
  }

  const pointsLabel = data?.settings.pointsLabel ?? "Scout Points";
  const slipOdds = slip.length ? combinedOdds(slip) : 0;

  if (loading)
    return (
      <SharedPage
        title={predictionsEnabled ? "Match Predictions" : "Scouting Points"}
        width="wide"
        className="scouting-page-frame"
        contentClassName="predictions-workspace"
      >
        <Loading />
      </SharedPage>
    );

  return (
    <SharedPage
      title={
        (data?.settings.predictionsEnabled ?? predictionsEnabled)
          ? "Match Predictions"
          : "Scouting Points"
      }
      width="wide"
      className="scouting-page-frame"
      contentClassName="predictions-workspace"
      description={data?.eventKey ? `Event: ${data.eventKey}` : undefined}
      actions={
        <Button variant="secondary" type="button" onClick={load} disabled={refreshing || placing}>
          {refreshing ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      }
    >
      {error && (
        <div role="alert">
          <ErrorBanner message={error} />
        </div>
      )}
      {data?.statsError && (
        <div role="alert">
          <ErrorBanner message={`Predictions paused: ${data.statsError}`} />
        </div>
      )}

      {data && (
        <Card>
          <div className="grid gap-5 sm:grid-cols-3">
            <Stat
              label={`Available ${pointsLabel}`}
              value={data.account.balance.toLocaleString()}
            />
            <Stat label="Earned scouting" value={data.account.earned.toLocaleString()} />
            <Stat label="Used on picks" value={data.account.wagered.toLocaleString()} />
          </div>
        </Card>
      )}
      {data?.settings.predictionsEnabled && (
        <details className="text-sm text-secondary-500">
          <summary className="cursor-pointer">How picks work</summary>
          <p className="mt-2">
            Pick the alliance that leads after the score adjustment. Every match in a combined pick
            must be correct. Points have no monetary value.
          </p>
        </details>
      )}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Prediction sections">
        {data?.settings.predictionsEnabled && (
          <Chip
            role="tab"
            aria-selected={section === "predictions"}
            selected={section === "predictions"}
            onClick={() => setSection("predictions")}
          >
            Match Picks
          </Chip>
        )}
        {data?.settings.leaderboardEnabled && (
          <Chip
            role="tab"
            aria-selected={section === "leaderboard"}
            selected={section === "leaderboard"}
            onClick={() => setSection("leaderboard")}
          >
            {pointsLabel} Standings
          </Chip>
        )}
      </div>

      {section === "predictions" && data?.settings.predictionsEnabled ? (
        <div className="game-layout">
          <div className="game-main">
            <div className="game-section-heading">
              <h2>Upcoming Matches</h2>
            </div>
            {matchesLoading && <div role="status">Loading predictions…</div>}
            {!matchesLoading && !data?.matches.length && !data?.statsError && !error && (
              <Card className="space-y-2">
                <h3 className="text-base font-semibold text-secondary-900">No upcoming matches</h3>
                <p className="text-sm text-secondary-500">
                  {data.eventKey
                    ? "Check back when the next matches are scheduled."
                    : "Choose an event in Admin to load matches for your team."}
                </p>
              </Card>
            )}
            <div className="game-match-list">
              {data?.matches.map((match) => {
                return (
                  <article className="game-match-card" key={match.key}>
                    <header>
                      <strong>{match.label}</strong>
                    </header>
                    <div className="predictions-columns" aria-hidden="true">
                      <span>Matchup</span>
                      <span>Adjustment / return</span>
                    </div>
                    <div className="predictions-row red">
                      <div className="predictions-team">
                        <strong>Red</strong>
                        <span>{match.redTeams.join(" / ")}</span>
                      </div>
                      <button
                        type="button"
                        disabled={matchesLoading || Boolean(data.statsError)}
                        aria-pressed={isSelected(match.key, "spread", "red")}
                        aria-label={`Pick Red for ${match.label}, adjustment ${signed(match.markets.spread.red)}`}
                        className={isSelected(match.key, "spread", "red") ? "selected" : ""}
                        onClick={() =>
                          choose({
                            match,
                            market: "spread",
                            selection: "red",
                            line: match.markets.spread.red,
                            label: `Red ${signed(match.markets.spread.red)}`,
                            odds: match.markets.spread.redOdds,
                          })
                        }
                      >
                        <span>{signed(match.markets.spread.red)}</span>
                        <b>{americanToDecimal(match.markets.spread.redOdds).toFixed(2)}x</b>
                      </button>
                    </div>
                    <div className="predictions-row blue">
                      <div className="predictions-team">
                        <strong>Blue</strong>
                        <span>{match.blueTeams.join(" / ")}</span>
                      </div>
                      <button
                        type="button"
                        disabled={matchesLoading || Boolean(data.statsError)}
                        aria-pressed={isSelected(match.key, "spread", "blue")}
                        aria-label={`Pick Blue for ${match.label}, adjustment ${signed(match.markets.spread.blue)}`}
                        className={isSelected(match.key, "spread", "blue") ? "selected" : ""}
                        onClick={() =>
                          choose({
                            match,
                            market: "spread",
                            selection: "blue",
                            line: match.markets.spread.blue,
                            label: `Blue ${signed(match.markets.spread.blue)}`,
                            odds: match.markets.spread.blueOdds,
                          })
                        }
                      >
                        <span>{signed(match.markets.spread.blue)}</span>
                        <b>{americanToDecimal(match.markets.spread.blueOdds).toFixed(2)}x</b>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <aside className="game-sidebar">
            <Card className="game-slip">
              <h2>Your picks {slip.length > 1 ? `(${slip.length} matches)` : ""}</h2>
              {slip.length ? (
                <>
                  <div className="parlay-legs">
                    {slip.map((leg) => (
                      <div key={leg.match.key}>
                        <span>
                          <strong>{leg.match.label}</strong>
                          <small>
                            {leg.label} / {americanToDecimal(leg.odds).toFixed(2)}x reward
                          </small>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setSlip((current) =>
                              current.filter((item) => item.match.key !== leg.match.key),
                            )
                          }
                          aria-label={`Remove ${leg.match.label}`}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="parlay-odds">
                    <span>Reward multiplier</span>
                    <strong>{americanToDecimal(slipOdds).toFixed(2)}x</strong>
                  </div>
                  <Field label="Points to use">
                    <input
                      className={inputClass}
                      type="number"
                      min="1"
                      max={Math.min(10_000, data?.account.balance ?? 0)}
                      step="1"
                      value={stake}
                      onChange={(event) => setStake(Math.floor(Number(event.target.value)))}
                    />
                  </Field>
                  <div className="game-return">
                    Points returned if correct
                    <strong>
                      {Math.floor(
                        stake +
                          (slipOdds > 0
                            ? (stake * slipOdds) / 100
                            : (stake * 100) / Math.abs(slipOdds)),
                      )}{" "}
                      {pointsLabel}
                    </strong>
                  </div>
                  <Button
                    variant="primary"
                    type="button"
                    disabled={
                      placing ||
                      matchesLoading ||
                      Boolean(data.statsError) ||
                      !Number.isInteger(stake) ||
                      stake < 1 ||
                      stake > 10_000 ||
                      stake > (data?.account.balance ?? 0)
                    }
                    onClick={placeBet}
                  >
                    {placing ? <Loader2 className="spin" size={17} /> : <Coins size={17} />} Submit{" "}
                    {slip.length > 1 ? "combined pick" : "pick"}
                  </Button>
                </>
              ) : (
                <p>Select an alliance to make a pick.</p>
              )}
            </Card>
          </aside>
        </div>
      ) : data?.settings.leaderboardEnabled ? (
        <section className="game-leaderboard game-leaderboard-full" role="tabpanel">
          <h2>
            <Trophy size={19} /> {pointsLabel} Standings
          </h2>
          <div
            className="game-leaderboard-table"
            role="region"
            aria-label="Team points standings"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: allow keyboard scrolling of standings
            tabIndex={0}
          >
            <div className="game-leaderboard-head">
              <span>Rank</span>
              <span>Name</span>
              <span>Balance</span>
              <span>Earned</span>
              <span>Used on picks</span>
            </div>
            {data?.leaderboard.map((player, index) => (
              <div className="game-leaderboard-row" key={`${player.display_name}-${index}`}>
                <b>#{index + 1}</b>
                <strong>{player.display_name}</strong>
                <span data-label="Balance">
                  {player.balance} {pointsLabel}
                </span>
                <span data-label="Earned">
                  {player.earned} {pointsLabel}
                </span>
                <span data-label="Used on picks">
                  {player.wagered} {pointsLabel}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {data?.settings.predictionsEnabled &&
        section === "predictions" &&
        !!(data?.bets.length || data?.parlays.length) && (
          <section className="game-history">
            <h2>Your prediction history</h2>
            <div className="game-history-grid">
              {data.parlays.map((parlay) => (
                <div key={parlay.id}>
                  <Badge
                    colors={
                      parlay.status === "won"
                        ? tones.success
                        : parlay.status === "lost"
                          ? tones.danger
                          : parlay.status === "open"
                            ? tones.warning
                            : tones.neutral
                    }
                  >
                    {statusLabel(parlay.status)}
                  </Badge>
                  <strong>Combined pick / {parlay.legs.length} matches</strong>
                  <span>{parlay.legs.map((leg) => leg.match_label).join(", ")}</span>
                  <b>
                    {parlay.stake} {pointsLabel} / {americanToDecimal(parlay.odds).toFixed(2)}x
                    reward
                    {parlay.payout > 0 ? ` → ${parlay.payout} ${pointsLabel}` : ""}
                  </b>
                </div>
              ))}
              {data.bets.map((bet) => (
                <div key={bet.id}>
                  <Badge
                    colors={
                      bet.status === "won"
                        ? tones.success
                        : bet.status === "lost"
                          ? tones.danger
                          : bet.status === "open"
                            ? tones.warning
                            : tones.neutral
                    }
                  >
                    {statusLabel(bet.status)}
                  </Badge>
                  <strong>{bet.match_label}</strong>
                  <span>
                    {bet.selection === "red" ? "Red" : "Blue"}{" "}
                    {signed(bet.selection === "red" ? bet.line : -bet.line)} /{" "}
                    {americanToDecimal(bet.odds).toFixed(2)}x reward
                  </span>
                  <b>
                    {bet.stake} {pointsLabel}
                    {bet.payout > 0 ? ` → ${bet.payout} ${pointsLabel}` : ""}
                  </b>
                </div>
              ))}
            </div>
          </section>
        )}
    </SharedPage>
  );
}
