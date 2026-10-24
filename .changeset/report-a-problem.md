---
"@g3/worker-platform": major
"@g3/worker-g3id": minor
"@g3/worker-portal": minor
"@g3/worker-shop": minor
"@g3/worker-pit": minor
"@g3/worker-skill-tree": minor
"@g3/worker-attendance": minor
"@g3/worker-scouting": minor
"@g3/worker-edge": minor
"@g3/worker-orders": minor
"@g3/worker-inventory": minor
"@g3/worker-schedule": minor
---

Report a problem or suggest an idea from any app: the menu has "Report a problem", which posts it as a public issue on Gearbox's GitHub with the page and app versions (never your name), and you get a Slack or Discord message when it's fixed or closed. No GitHub account needed. Not in the public demo. Deployers: apply the platform's migration `0012_problem_reports.sql` before deploying it, and set its `GITHUB_TOKEN` secret (`docs/deploy.md`, "Problem reports on GitHub"); without it, reports are kept, and those under a week old are sent once it's set.
