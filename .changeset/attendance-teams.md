---
"@g3/worker-attendance": major
"@g3/worker-g3id": minor
---

Attendance keeps each team's records and settings to itself, and admins set when the school year starts and how long a session may stay open on G3ID's Attendance page. The kiosk and sign-in pages use the same colors and fonts as the other apps, with the kiosk always dark. Deployers: apply Attendance's migration `0002_teams.sql` (`pnpm --filter @g3/worker-attendance run db:migrate:remote`) before deploying its worker.
