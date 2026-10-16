---
"@g3/worker-inventory": major
"@g3/worker-orders": patch
---

Inventory keeps each team's parts, locations and history to itself, and parts received in Orders go into the receiving member's own team's Inventory. Deployers: apply Inventory's migration `0003_teams.sql` (`pnpm --filter @g3/worker-inventory run db:migrate:remote`) before deploying its worker.
