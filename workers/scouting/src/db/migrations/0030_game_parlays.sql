CREATE TABLE game_parlays (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  event_key TEXT NOT NULL,
  odds INTEGER NOT NULL,
  stake INTEGER NOT NULL CHECK (stake > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'push')),
  payout INTEGER NOT NULL DEFAULT 0,
  placed_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE TABLE game_parlay_legs (
  id TEXT PRIMARY KEY NOT NULL,
  parlay_id TEXT NOT NULL,
  match_key TEXT NOT NULL,
  match_label TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('spread', 'total', 'moneyline')),
  selection TEXT NOT NULL,
  line REAL NOT NULL,
  odds INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'push')),
  FOREIGN KEY (parlay_id) REFERENCES game_parlays(id) ON DELETE CASCADE,
  UNIQUE (parlay_id, match_key)
);

CREATE INDEX game_parlays_user_idx ON game_parlays(user_id, placed_at DESC);
CREATE INDEX game_parlays_open_idx ON game_parlays(event_key, status);
CREATE INDEX game_parlay_legs_parlay_idx ON game_parlay_legs(parlay_id);

-- No CASE ... END in this trigger: D1's remote statement splitter would end it at the first
-- "END;" ("incomplete input").
CREATE TRIGGER game_parlays_require_funds
BEFORE INSERT ON game_parlays
BEGIN
  SELECT RAISE(ABORT, 'insufficient BoyleBucks')
  WHERE COALESCE(
    (SELECT balance FROM boylebucks_accounts WHERE user_id = NEW.user_id),
    -1
  ) < NEW.stake;
END;
