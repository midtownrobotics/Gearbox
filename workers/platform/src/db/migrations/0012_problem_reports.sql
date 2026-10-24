-- Problems and ideas members report from any app's bar (src/reports.ts). Each becomes a public
-- GitHub issue on Gearbox's repository; the row remembers who sent it, so they can be told when
-- it's closed. Deleted with the team.
CREATE TABLE problem_reports (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('problem', 'idea')),
  message TEXT NOT NULL,
  -- The page it was sent from, without its query string: "https://1648-orders.frcgearbox.com/requests".
  page TEXT NOT NULL,
  -- The app's slug, from the page's address, or null when it can't tell.
  app TEXT,
  version TEXT,
  browser TEXT,
  -- The GitHub issue, once it's made (an hourly cron tries again until then).
  issue_number INTEGER,
  issue_url TEXT,
  -- open, then fixed or closed (closed without a fix: not planned, a duplicate).
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'closed')),
  closed_at INTEGER,
  -- When the cron last asked GitHub about the issue.
  checked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX problem_reports_user ON problem_reports (team_id, user_id, created_at);
CREATE INDEX problem_reports_open ON problem_reports (status, checked_at);
