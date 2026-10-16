CREATE TABLE boylebucks_accounts (
  user_id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  earned INTEGER NOT NULL DEFAULT 0 CHECK (earned >= 0),
  wagered INTEGER NOT NULL DEFAULT 0 CHECK (wagered >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE boylebucks_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE game_bets (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  event_key TEXT NOT NULL,
  match_key TEXT NOT NULL,
  match_label TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('spread', 'total', 'moneyline')),
  selection TEXT NOT NULL,
  line REAL NOT NULL,
  odds INTEGER NOT NULL,
  stake INTEGER NOT NULL CHECK (stake > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'push')),
  payout INTEGER NOT NULL DEFAULT 0,
  placed_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE (user_id, match_key, market)
);

CREATE INDEX boylebucks_accounts_rank_idx
  ON boylebucks_accounts(balance DESC, earned DESC, display_name);
CREATE INDEX boylebucks_ledger_user_idx
  ON boylebucks_ledger(user_id, created_at DESC);
CREATE INDEX game_bets_user_idx
  ON game_bets(user_id, placed_at DESC);
CREATE INDEX game_bets_open_idx
  ON game_bets(event_key, status, match_key);

-- No CASE ... END in this trigger: D1's remote statement splitter would end it at the first
-- "END;" ("incomplete input").
CREATE TRIGGER game_bets_require_funds
BEFORE INSERT ON game_bets
BEGIN
  SELECT RAISE(ABORT, 'insufficient BoyleBucks')
  WHERE COALESCE(
    (SELECT balance FROM boylebucks_accounts WHERE user_id = NEW.user_id),
    -1
  ) < NEW.stake;
END;
